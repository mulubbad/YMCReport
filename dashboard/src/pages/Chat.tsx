import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { ArrowDown, ChevronDown, Hash, Loader2, MessageSquareText, Pin, Search, Users, X } from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { cn } from "@/lib/utils"
import { ROLE_LABEL, initials, notify, parseUtc } from "@/components/tasks/shared"
import { Composer } from "@/components/chat/Composer"
import { Message, ROLE_TILE, ROLE_VARIANT } from "@/components/chat/Message"
import { useChatStream, type ChatMsg, type Member, type Tag } from "@/components/chat/stream"

const LIMIT = 50
// local YYYY-MM-DD with Latin digits (server timestamps are UTC)
const ymd = (d: Date) => d.toLocaleDateString("en-CA")
const dayLabel = (day: string) => {
  const now = new Date()
  if (day === ymd(now)) return "اليوم"
  now.setDate(now.getDate() - 1)
  return day === ymd(now) ? "أمس" : day
}
const smooth = (): ScrollBehavior => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth")

function Rail({
  members,
  online,
  tags,
  activeTag,
  onTag,
}: {
  members: Member[]
  online: Set<number>
  tags: Tag[]
  activeTag: string | null
  onTag: (t: string | null) => void
}) {
  const sorted = [...members].sort((a, b) => Number(online.has(b.id)) - Number(online.has(a.id)))
  return (
    <div className="flex flex-col gap-5">
      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">الأعضاء ({members.length})</h3>
        <ul className="space-y-0.5">
          {sorted.map((m) => {
            const on = online.has(m.id)
            return (
              <li key={m.id} className="flex min-h-11 items-center gap-2">
                <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold", ROLE_TILE[m.role])}>
                  {initials(m.name) || "؟"}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                <Badge variant={ROLE_VARIANT[m.role]}>{ROLE_LABEL[m.role]}</Badge>
                <span className={cn("size-2 shrink-0 rounded-full", on ? "bg-success" : "bg-muted-foreground/40")} aria-hidden />
                <span className="sr-only">{on ? "متصل" : "غير متصل"}</span>
              </li>
            )
          })}
        </ul>
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">الوسوم الرائجة</h3>
        {tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد وسوم بعد</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {tags.map((t) => {
              const on = activeTag === t.tag
              return (
                <li key={t.tag}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => onTag(on ? null : t.tag)}
                    className={cn(
                      "inline-flex min-h-9 items-center gap-1 rounded-md border px-2.5 text-xs font-semibold transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-transparent bg-muted text-muted-foreground hover:bg-primary-light hover:text-primary",
                    )}
                  >
                    <Hash className="size-3" aria-hidden />
                    {t.tag}
                    <span className="tabular-nums opacity-70">{t.count}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

export default function Chat() {
  const me = useAuth().user!
  const isSuper = me.role === "super"
  const [params, setParams] = useSearchParams()
  const [groups, setGroups] = useState<{ id: number; name: string }[]>([])
  const [groupId, setGroupId] = useState<number | undefined>(() => (isSuper && Number(params.get("group_id"))) || undefined)
  const [groupName, setGroupName] = useState("")
  const ready = !isSuper || !!groupId
  // super scopes every call with ?group_id
  const gq = useCallback(
    (path: string) => (isSuper && groupId ? `${path}${path.includes("?") ? "&" : "?"}group_id=${groupId}` : path),
    [isSuper, groupId],
  )

  const [members, setMembers] = useState<Member[]>([])
  const [online, setOnline] = useState<Set<number>>(new Set())
  const [tags, setTags] = useState<Tag[]>([])
  const [pinned, setPinned] = useState<ChatMsg[]>([])
  const [pinsOpen, setPinsOpen] = useState(false)
  const [msgs, setMsgs] = useState<ChatMsg[] | null>(null)
  const [next, setNext] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [tag, setTag] = useState<string | null>(null)
  const [fresh, setFresh] = useState(0) // arrived while scrolled up
  const [target, setTarget] = useState<number | null>(null) // message to reveal (deep link / pinned click)
  const [highlight, setHighlight] = useState<number | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ChatMsg | null>(null)
  const [railOpen, setRailOpen] = useState(false)

  const listRef = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const stick = useRef(false) // scroll to bottom after the next render
  const prepend = useRef<number | null>(null) // scrollHeight before older messages were prepended
  const older = useRef(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const tries = useRef(0)
  const lastRead = useRef(0)
  const filtered = !!q || !!tag

  const byUsername = useMemo(() => new Map(members.map((m) => [m.username.toLowerCase(), m])), [members])
  const listPath = useCallback(
    (before?: number | null) => {
      const p = new URLSearchParams({ limit: String(LIMIT) })
      if (before) p.set("before", String(before))
      if (tag) p.set("tag", tag)
      if (q) p.set("q", q)
      return gq(`/chat/messages?${p}`)
    },
    [gq, q, tag],
  )

  const markRead = useCallback((id: number) => {
    if (id <= lastRead.current) return
    lastRead.current = id
    api.put("/chat/read", { last_id: id }).then(notify).catch(() => {})
  }, [])
  const loadTags = useCallback(() => api.get(gq("/chat/tags")).then(setTags).catch(() => {}), [gq])
  const loadPinned = useCallback(() => api.get(gq("/chat/pinned")).then(setPinned).catch(() => {}), [gq])
  const patch = (id: number, p: Partial<ChatMsg>) => setMsgs((l) => l && l.map((m) => (m.id === id ? { ...m, ...p } : m)))

  // group: super picks from /groups (URL ?group_id wins), others read their team name
  useEffect(() => {
    if (isSuper)
      api
        .get("/groups")
        .then((gs: { id: number; name: string }[]) => {
          setGroups(gs)
          setGroupId((g) => g ?? gs[0]?.id)
        })
        .catch((e) => toast.error(e.message))
    else api.get("/tasks/team").then((t) => setGroupName(t.group?.name ?? "")).catch(() => {})
  }, [isSuper])
  useEffect(() => {
    if (isSuper && groupId) setGroupName(groups.find((g) => g.id === groupId)?.name ?? "")
  }, [isSuper, groupId, groups])

  // room data
  useEffect(() => {
    if (!ready) return
    api
      .get(gq("/chat/members"))
      .then((ms: Member[]) => {
        setMembers(ms)
        setOnline(new Set(ms.filter((m) => m.online).map((m) => m.id)))
      })
      .catch((e) => toast.error(e.message))
    void loadTags()
    void loadPinned()
  }, [ready, gq, loadTags, loadPinned])

  // message list: reload from scratch when the room or a filter changes
  useEffect(() => {
    if (!ready) return
    let stale = false
    setMsgs(null)
    setNext(null)
    setFresh(0)
    api
      .get(listPath())
      .then((r: { items: ChatMsg[]; next: number | null }) => {
        if (stale) return
        stick.current = true
        setMsgs(r.items)
        setNext(r.next)
        if (!filtered && r.items.length) markRead(r.items[r.items.length - 1].id)
      })
      .catch((e) => {
        if (stale) return
        toast.error(e.message)
        setMsgs([]) // e.g. caller has no group — leave the empty state rather than a forever-skeleton
      })
    return () => {
      stale = true
    }
  }, [ready, listPath]) // eslint-disable-line react-hooks/exhaustive-deps -- filtered/markRead are derived from the same inputs

  // search debounce → q
  useEffect(() => {
    const t = window.setTimeout(() => setQ(search.trim()), 300)
    return () => window.clearTimeout(t)
  }, [search])

  // keep the viewport steady: stick to bottom on load/own sends, preserve offset when older messages are prepended
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    if (prepend.current !== null) {
      el.scrollTop += el.scrollHeight - prepend.current
      prepend.current = null
    }
    if (stick.current) {
      el.scrollTop = el.scrollHeight
      stick.current = false
      nearBottom.current = true
    }
  }, [msgs])

  const loadOlder = useCallback(async () => {
    if (!next || older.current || !listRef.current) return
    older.current = true
    setLoadingOlder(true)
    try {
      const r = await api.get(listPath(next))
      prepend.current = listRef.current.scrollHeight
      setMsgs((l) => [...r.items, ...(l ?? [])])
      setNext(r.next)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      older.current = false
      setLoadingOlder(false)
    }
  }, [next, listPath])

  // ?m=<id> deep link (once the first page is in)
  useEffect(() => {
    const m = Number(params.get("m"))
    if (!m || !msgs) return
    setTarget(m)
    params.delete("m")
    setParams(params, { replace: true })
  }, [msgs === null])

  // ponytail: no "around" endpoint — page backwards until the target shows up (≤10 pages) so the list stays contiguous
  useEffect(() => {
    if (target === null || !msgs) return
    const el = document.getElementById(`msg-${target}`)
    if (el) {
      el.scrollIntoView({ block: "center", behavior: smooth() })
      setHighlight(target)
      window.setTimeout(() => setHighlight((h) => (h === target ? null : h)), 2000)
      setTarget(null)
      tries.current = 0
      return
    }
    if (next && tries.current++ < 10) void loadOlder()
    else {
      setTarget(null)
      tries.current = 0
      toast.error("الرسالة غير موجودة في هذه المحادثة")
    }
  }, [target, msgs, next, loadOlder])

  // tab regained focus → everything loaded is read
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && !filtered && msgs?.length) markRead(msgs[msgs.length - 1].id)
    }
    document.addEventListener("visibilitychange", onVis)
    return () => document.removeEventListener("visibilitychange", onVis)
  }, [msgs, filtered, markRead])

  const reconnecting = useChatStream(
    isSuper ? groupId : undefined,
    {
      message: (m) => {
        if (m.hashtags?.length) void loadTags()
        if (document.visibilityState === "visible") markRead(m.id)
        if (filtered) return // a filtered view never splices live messages in
        const own = m.user_id === me.id
        if (own || nearBottom.current) stick.current = true
        else setFresh((n) => n + 1)
        setMsgs((l) => (l?.some((x) => x.id === m.id) ? l : [...(l ?? []), m]))
      },
      deleted: ({ id }) => {
        patch(id, { deleted: 1, body: null, image_url: null })
        setPinned((p) => p.filter((x) => x.id !== id))
      },
      pinned: ({ id, pinned }) => {
        patch(id, { pinned })
        void loadPinned()
      },
      presence: ({ online }) => setOnline(new Set(online)),
      // stream was down for a while → pull the tail and splice in whatever arrived meanwhile
      reconnect: () => {
        if (filtered) return
        api
          .get(listPath())
          .then((r: { items: ChatMsg[] }) =>
            setMsgs((l) => {
              const have = new Set((l ?? []).map((m) => m.id))
              const missed = r.items.filter((m) => !have.has(m.id))
              if (!missed.length) return l
              if (nearBottom.current) stick.current = true
              else setFresh((n) => n + missed.length)
              return [...(l ?? []), ...missed]
            }),
          )
          .catch(() => {})
        void loadPinned()
      },
    },
    ready,
  )

  const onScroll = () => {
    const el = listRef.current!
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom.current) setFresh(0)
    if (el.scrollTop < 40) void loadOlder()
  }

  const send = async (body: string, file: File | null) => {
    let image_key: string | undefined
    if (file) {
      const fd = new FormData()
      fd.append("file", file)
      image_key = (await api.upload(gq("/chat/upload"), fd)).image_key
    }
    const m: ChatMsg = await api.post(gq("/chat/messages"), { body: body || undefined, image_key })
    stick.current = true
    setMsgs((l) => (l?.some((x) => x.id === m.id) ? l : [...(l ?? []), m]))
    markRead(m.id)
    if (m.hashtags?.length) void loadTags()
  }

  const togglePin = (m: ChatMsg) =>
    api
      .put(`/chat/messages/${m.id}/pin`, { pinned: m.pinned ? 0 : 1 })
      .then(() => {
        patch(m.id, { pinned: m.pinned ? 0 : 1 })
        void loadPinned()
        toast.success(m.pinned ? "أُلغي التثبيت" : "ثُبّتت الرسالة")
      })
      .catch((e) => toast.error(e.message))

  const remove = async () => {
    if (!deleting) return
    try {
      await api.del(`/chat/messages/${deleting.id}`)
      patch(deleting.id, { deleted: 1, body: null, image_url: null })
      setPinned((p) => p.filter((x) => x.id !== deleting.id))
      setDeleting(null)
      toast.success("حُذفت الرسالة")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const jumpDown = () => {
    const el = listRef.current!
    el.scrollTo({ top: el.scrollHeight, behavior: smooth() })
    setFresh(0)
  }

  const onlineMembers = members.filter((m) => online.has(m.id))
  const rail = <Rail members={members} online={online} tags={tags} activeTag={tag} onTag={setTag} />

  return (
    <Card className="flex h-[calc(100dvh-65px-2rem)] flex-row gap-0 overflow-hidden p-0 lg:h-[calc(100dvh-65px-4rem)]">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <div className="flex flex-wrap items-center gap-2 border-b border-secondary px-3 py-2.5 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-light text-primary">
              <MessageSquareText className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold">{groupName || "محادثة الفريق"}</h2>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>متصل الآن {onlineMembers.length}</span>
                {onlineMembers.length > 0 && (
                  <span className="flex" aria-hidden>
                    {onlineMembers.slice(0, 4).map((m) => (
                      <span
                        key={m.id}
                        title={m.name}
                        className={cn("-ms-1.5 flex size-6 items-center justify-center rounded-full text-[10px] font-semibold ring-2 ring-card first:ms-0", ROLE_TILE[m.role])}
                      >
                        {initials(m.name)}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="ms-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {isSuper && (
              <Select
                value={groupId ? String(groupId) : ""}
                onValueChange={(v) => {
                  setGroupId(Number(v))
                  setParams({ group_id: v }, { replace: true })
                }}
              >
                <SelectTrigger className="h-10 w-full sm:w-44" aria-label="المجموعة">
                  <SelectValue placeholder="اختر مجموعة" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="relative min-w-0 flex-1 sm:w-52 sm:flex-none">
              <Search className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث في الرسائل"
                aria-label="بحث في الرسائل"
                className="h-10 ps-9"
              />
            </div>
            {tag && (
              <Badge variant="primary-light" className="h-10 gap-1 px-2.5 text-sm">
                <Hash className="size-3.5" aria-hidden />
                {tag}
                <button
                  type="button"
                  className="-me-1 flex size-7 items-center justify-center rounded-full outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring/50"
                  aria-label="إزالة تصفية الوسم"
                  onClick={() => setTag(null)}
                >
                  <X className="size-3.5" />
                </button>
              </Badge>
            )}
            <Button variant="light" className="h-10 lg:hidden" onClick={() => setRailOpen(true)}>
              <Users />
              الأعضاء
            </Button>
          </div>
        </div>

        {/* pinned bar */}
        {pinned.length > 0 && (
          <div className="border-b border-secondary bg-warning-light/60 px-3 sm:px-4">
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 text-sm font-semibold text-warning outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-expanded={pinsOpen}
              onClick={() => setPinsOpen((o) => !o)}
            >
              <Pin className="size-4" aria-hidden />
              الرسائل المثبّتة ({pinned.length})
              {!pinsOpen && <span className="min-w-0 flex-1 truncate text-start font-normal text-foreground/80">{pinned[0].body ?? "صورة"}</span>}
              <ChevronDown className={cn("ms-auto size-4 shrink-0 transition-transform duration-200", pinsOpen && "rotate-180")} aria-hidden />
            </button>
            {pinsOpen && (
              <ul className="max-h-48 overflow-y-auto pb-2">
                {pinned.slice(0, 10).map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-start text-sm outline-none hover:bg-card focus-visible:ring-2 focus-visible:ring-ring/50"
                      onClick={() => {
                        setPinsOpen(false)
                        if (filtered) {
                          setTag(null)
                          setSearch("")
                        }
                        setTarget(p.id)
                      }}
                    >
                      <span className="shrink-0 font-semibold">{p.user_name ?? "مستخدم محذوف"}:</span>
                      <span className="min-w-0 flex-1 truncate text-foreground/80">{p.body ?? "صورة"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* messages */}
        <div className="relative min-h-0 flex-1">
          {reconnecting && (
            <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
              <span role="status" className="inline-flex items-center gap-1.5 rounded-full bg-warning-light px-3 py-1 text-xs font-semibold text-warning shadow">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                جارٍ إعادة الاتصال…
              </span>
            </div>
          )}
          <div ref={listRef} onScroll={onScroll} className="h-full overflow-y-auto px-3 py-3 sm:px-4" aria-busy={msgs === null}>
            {msgs === null ? (
              <div className="space-y-4">
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className={cn("flex gap-3", i % 3 === 2 && "flex-row-reverse")}>
                    <Skeleton className="size-8 rounded-md" />
                    <div className="w-1/2 space-y-2">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : msgs.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <span className="flex size-14 items-center justify-center rounded-lg bg-primary-light text-primary">
                  <MessageSquareText className="size-7" />
                </span>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {filtered ? "لا توجد رسائل مطابقة" : "ابدأ المحادثة مع فريقك — اكتب @ للإشارة إلى زميل و # لوسم الموضوع"}
                </p>
                {filtered && (
                  <Button
                    variant="light"
                    onClick={() => {
                      setTag(null)
                      setSearch("")
                    }}
                  >
                    <X />
                    مسح التصفية
                  </Button>
                )}
              </div>
            ) : (
              <ol className="flex flex-col gap-2" aria-label="الرسائل">
                {loadingOlder && (
                  <li className="flex justify-center py-1" aria-hidden>
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </li>
                )}
                {msgs.map((m, i) => {
                  const day = ymd(parseUtc(m.created_at))
                  const prev = i ? ymd(parseUtc(msgs[i - 1].created_at)) : null
                  return (
                    <Fragment key={m.id}>
                      {day !== prev && (
                        <li className="my-2 flex items-center gap-3 text-xs font-semibold text-muted-foreground">
                          <span className="h-px flex-1 bg-border" aria-hidden />
                          {dayLabel(day)}
                          <span className="h-px flex-1 bg-border" aria-hidden />
                        </li>
                      )}
                      <Message
                        m={m}
                        me={me}
                        byUsername={byUsername}
                        highlighted={highlight === m.id}
                        onTag={setTag}
                        onImage={setLightbox}
                        onPin={togglePin}
                        onDelete={setDeleting}
                      />
                    </Fragment>
                  )
                })}
              </ol>
            )}
          </div>
          {fresh > 0 && (
            <Button
              size="sm"
              className="absolute bottom-3 start-1/2 h-10 -translate-x-1/2 rounded-full shadow-lg"
              onClick={jumpDown}
            >
              <ArrowDown />
              رسائل جديدة ({fresh})
            </Button>
          )}
        </div>

        <Composer members={members} tags={tags} onSend={send} />
      </div>

      {/* right rail (desktop) */}
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-s border-secondary p-4 lg:block" aria-label="أعضاء المحادثة والوسوم">
        {rail}
      </aside>

      <Dialog open={railOpen} onOpenChange={setRailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>الأعضاء والوسوم</DialogTitle>
          </DialogHeader>
          {rail}
        </DialogContent>
      </Dialog>

      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="w-auto max-w-[95vw] bg-black/90 p-2 sm:max-w-[90vw]">
          <DialogTitle className="sr-only">عرض الصورة</DialogTitle>
          {lightbox && <img src={lightbox} alt="" className="max-h-[85dvh] max-w-full rounded-md object-contain" />}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الرسالة؟</AlertDialogTitle>
            <AlertDialogDescription>ستُحذف الرسالة من المحادثة لجميع الأعضاء ولا يمكن التراجع.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>حذف الرسالة</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
