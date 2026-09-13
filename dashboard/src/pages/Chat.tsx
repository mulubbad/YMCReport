import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { ArrowDown, ChevronDown, Hash, ImageIcon, Loader2, MessageSquareText, Pin, Search, Users, X } from "lucide-react"
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
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useScope } from "@/lib/scope"
import { useDeepLink } from "@/lib/deeplink"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { ROLE_LABEL, initials, notify, parseUtc } from "@/components/tasks/shared"
import { Composer } from "@/components/chat/Composer"
import { Message, ROLE_TILE, ROLE_VARIANT } from "@/components/chat/Message"
import { useChatStream, type ChatMsg, type Member, type Role, type Tag } from "@/components/chat/stream"

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

// a private thread with one other member of the room
export type Conv = {
  id: number
  name: string
  username: string
  role: Role
  online: boolean
  unread: number
  last: { id: number; mine: boolean; body: string | null; image: number; deleted: number; created_at: string } | null
}

const tabClass =
  "h-auto flex-none rounded-none px-1 pb-2.5 pt-1 text-sm font-semibold text-muted-foreground group-data-[orientation=horizontal]/tabs:after:bottom-0 after:h-0.5 after:bg-primary data-[state=active]:text-primary"

const unreadPill = (n: number) =>
  n > 0 && (
    <span className="min-w-5 shrink-0 rounded-full bg-primary px-1.5 text-center text-[10px] leading-5 font-semibold text-primary-foreground tabular-nums">
      {n > 99 ? "99+" : n}
    </span>
  )

// conversation switcher: the group room first, then every private thread (newest first)
function Convs({
  convs,
  online,
  dm,
  roomName,
  roomUnread,
  onOpen,
}: {
  convs: Conv[]
  online: Set<number> // live presence; Conv.online is only the value at fetch time
  dm: number | null
  roomName: string
  roomUnread: number
  onOpen: (peer: number | null) => void
}) {
  const row = "flex min-h-12 w-full items-center gap-2 rounded-md px-2 text-start outline-none transition-colors duration-150 hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring/50"
  return (
    <ul className="space-y-0.5">
      <li>
        <button type="button" aria-current={dm === null} onClick={() => onOpen(null)} className={cn(row, dm === null && "bg-primary-light")}>
          <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-light text-primary">
            <MessageSquareText className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{roomName || "محادثة الفريق"}</span>
            <span className="block truncate text-xs text-muted-foreground">الجميع في المجموعة</span>
          </span>
          {unreadPill(roomUnread)}
        </button>
      </li>
      {convs.map((c) => (
        <li key={c.id}>
          <button type="button" aria-current={dm === c.id} onClick={() => onOpen(c.id)} className={cn(row, dm === c.id && "bg-primary-light")}>
            <span className="relative shrink-0">
              <span aria-hidden className={cn("flex size-8 items-center justify-center rounded-md text-xs font-semibold", ROLE_TILE[c.role])}>
                {initials(c.name) || "؟"}
              </span>
              {online.has(c.id) && <span className="absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full border-2 border-card bg-success" aria-hidden />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{c.name}</span>
              <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                {c.last ? (
                  c.last.deleted ? (
                    <span className="italic">تم حذف الرسالة</span>
                  ) : c.last.body ? (
                    <>
                      {c.last.mine && <span className="shrink-0">أنت:</span>}
                      <span className="truncate">{c.last.body}</span>
                    </>
                  ) : (
                    <>
                      <ImageIcon className="size-3 shrink-0" aria-hidden />
                      صورة
                    </>
                  )
                ) : (
                  "ابدأ محادثة خاصة"
                )}
              </span>
            </span>
            {unreadPill(c.unread)}
          </button>
        </li>
      ))}
    </ul>
  )
}

function Rail({
  members,
  online,
  tags,
  activeTag,
  onTag,
  convs,
  dm,
  roomName,
  roomUnread,
  meId,
  onOpen,
}: {
  members: Member[]
  online: Set<number>
  tags: Tag[]
  activeTag: string | null
  onTag: (t: string | null) => void
  convs: Conv[]
  dm: number | null
  roomName: string
  roomUnread: number
  meId: number
  onOpen: (peer: number | null) => void
}) {
  const sorted = [...members].sort((a, b) => Number(online.has(b.id)) - Number(online.has(a.id)))
  const totalUnread = convs.reduce((n, c) => n + c.unread, 0)
  return (
    <Tabs defaultValue="convs" className="gap-0">
      <TabsList variant="line" className="mb-3 gap-5 p-0 group-data-[orientation=horizontal]/tabs:h-auto">
        <TabsTrigger value="convs" className={tabClass}>
          المحادثات
          {unreadPill(totalUnread)}
        </TabsTrigger>
        <TabsTrigger value="team" className={tabClass}>
          الفريق
        </TabsTrigger>
      </TabsList>
      <TabsContent value="convs">
        <Convs convs={convs} online={online} dm={dm} roomName={roomName} roomUnread={roomUnread} onOpen={onOpen} />
      </TabsContent>
      <TabsContent value="team">
    <div className="flex flex-col gap-5">
      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">الأعضاء ({members.length})</h3>
        <ul className="space-y-0.5">
          {sorted.map((m) => {
            const on = online.has(m.id)
            return (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={!onOpen || m.id === meId}
                  onClick={() => onOpen(m.id)}
                  aria-label={m.id === meId ? m.name : `محادثة خاصة مع ${m.name}`}
                  className="flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-start outline-none transition-colors duration-150 enabled:hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default"
                >
                <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold", ROLE_TILE[m.role])}>
                  {initials(m.name) || "؟"}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                <Badge variant={ROLE_VARIANT[m.role]}>{ROLE_LABEL[m.role]}</Badge>
                <span className={cn("size-2 shrink-0 rounded-full", on ? "bg-success" : "bg-muted-foreground/40")} aria-hidden />
                <span className="sr-only">{on ? "متصل" : "غير متصل"}</span>
                </button>
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
      </TabsContent>
    </Tabs>
  )
}

export default function Chat() {
  const me = useAuth().user!
  const isSuper = me.role === "super"
  const [params, setParams] = useSearchParams()
  // The room follows the workspace switcher, but is resolved LOCALLY: picking a room here must never
  // rewrite the global workspace (a super browsing «كل المجموعات» would lose it everywhere else).
  const { gid, active, groups, loading: scopeLoading } = useScope()
  const urlGroup = Number(params.get("group_id")) || null
  const room =
    gid ??
    (urlGroup && groups.some((g) => g.id === urlGroup) ? urlGroup : null) ??
    (isSuper ? (groups[0]?.id ?? null) : null)
  const groupId = room ?? undefined
  const [teamName, setTeamName] = useState("")
  const groupName = active?.name ?? groups.find((g) => g.id === room)?.name ?? teamName
  const ready = isSuper ? !!room : !scopeLoading
  // api.ts appends the ACTIVE group; when the room is local (super on «كل المجموعات», or a deep link)
  // it has to be spelled out instead
  const cq = useCallback(
    (p: string) => (gid == null && room ? `${p}${p.includes("?") ? "&" : "?"}group_id=${room}` : p),
    [gid, room],
  )

  // dm = the peer whose private thread is open; null = the group room. Seeded from ?dm= so a push link
  // never loads (and silently marks read) the group room on its way to the thread.
  const [dm, setDm] = useState<number | null>(() => Number(params.get("dm")) || null)
  const [convs, setConvs] = useState<Conv[]>([])
  const [roomUnread, setRoomUnread] = useState(0)
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
  const epoch = useRef(0) // bumped on every thread/filter switch; in-flight pages from the old one are dropped
  const lastRead = useRef<Record<string, number>>({})
  const filtered = dm === null && (!!q || !!tag)

  const byUsername = useMemo(() => new Map(members.map((m) => [m.username.toLowerCase(), m])), [members])
  const listPath = useCallback(
    (before?: number | null) => {
      const p = new URLSearchParams({ limit: String(LIMIT) })
      if (before) p.set("before", String(before))
      if (dm !== null) return cq(`/chat/dm/${dm}/messages?${p}`) // search and tags are room-only
      if (tag) p.set("tag", tag)
      if (q) p.set("q", q)
      return cq(`/chat/messages?${p}`)
    },
    [cq, q, tag, dm],
  )

  // one high-water mark PER conversation (0 = the room): message ids are globally increasing, so a single
  // monotonic ref would silently stop marking an older thread read after you opened a newer one
  const markRead = useCallback(
    (id: number, peer: number | null = dm) => {
      const key = `${room}:${peer ?? 0}`
      if (id <= (lastRead.current[key] ?? 0)) return
      lastRead.current[key] = id
      api.put(cq(peer === null ? "/chat/read" : `/chat/dm/${peer}/read`), { last_id: id }).then(notify).catch(() => {})
      if (peer === null) setRoomUnread(0)
      else setConvs((l) => l.map((c) => (c.id === peer ? { ...c, unread: 0 } : c)))
    },
    [cq, dm, room],
  )
  // J: the list is fetched in the same tick as the read PUT, so it can still report a message we just
  // marked read — clamp against the local high-water mark rather than flashing a stale pill
  const loadConvs = useCallback(
    () =>
      api
        .get(cq("/chat/dm"))
        .then((rows: Conv[]) =>
          setConvs(rows.map((c) => (c.last && c.last.id <= (lastRead.current[`${room}:${c.id}`] ?? 0) ? { ...c, unread: 0 } : c))),
        )
        .catch(() => {}),
    [cq, room],
  )
  const loadTags = useCallback(() => api.get(cq("/chat/tags")).then(setTags).catch(() => {}), [cq])
  const loadPinned = useCallback(() => api.get(cq("/chat/pinned")).then(setPinned).catch(() => {}), [cq])
  const patch = (id: number, p: Partial<ChatMsg>) => setMsgs((l) => l && l.map((m) => (m.id === id ? { ...m, ...p } : m)))

  // members have no switcher — read the room's name from their team
  useEffect(() => {
    if (!active) api.get("/tasks/team").then((t) => setTeamName(t.group?.name ?? "")).catch(() => {})
  }, [active])

  // room data
  useEffect(() => {
    if (!ready) return
    api
      .get(cq("/chat/members"))
      .then((ms: Member[]) => {
        setMembers(ms)
        setOnline(new Set(ms.filter((m) => m.online).map((m) => m.id)))
      })
      .catch((e) => toast.error(e.message))
    void loadTags()
    void loadPinned()
    void loadConvs()
  }, [ready, cq, loadTags, loadPinned, loadConvs])

  // message list: reload from scratch when the room or a filter changes
  useEffect(() => {
    if (!ready) return
    let stale = false
    epoch.current++
    setMsgs(null)
    setNext(null)
    setFresh(0)
    // ponytail: switching thread refetches instead of caching per-thread scrollback — reset what the
    // viewport logic carries, or the new thread inherits the old one's anchor and "new messages" pill
    nearBottom.current = true
    tries.current = 0
    setTarget(null)
    setHighlight(null)
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
    const mine = epoch.current
    try {
      const r = await api.get(listPath(next))
      if (mine !== epoch.current) return // switched thread while this page was in flight
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
    if (!m || !msgs || dm !== null) return
    setTarget(m)
    params.delete("m")
    setParams(params, { replace: true })
  }, [msgs === null])

  // ponytail: no "around" endpoint — page backwards until the target shows up (≤10 pages) so the list stays contiguous
  useEffect(() => {
    if (target === null || !msgs || dm !== null) return
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
    groupId,
    {
      message: (m) => {
        if (m.hashtags?.length) void loadTags()
        // a room message while a private thread is open only bumps the room's pill
        if (dm !== null) {
          if (m.user_id !== me.id) {
            setRoomUnread((n) => n + 1)
            notify() // the sidebar badge owns the unread total, and nothing marked this one read
          }
          return
        }
        if (document.visibilityState === "visible") markRead(m.id, null)
        if (filtered) return // a filtered view never splices live messages in
        const own = m.user_id === me.id
        if (own || nearBottom.current) stick.current = true
        else setFresh((n) => n + 1)
        setMsgs((l) => (l?.some((x) => x.id === m.id) ? l : [...(l ?? []), m]))
      },
      // chat_messages and dm_messages have independent AUTOINCREMENTs, so a room frame's id can collide
      // with an open thread's — room events only apply while the room is the open conversation
      deleted: ({ id }) => {
        if (dm !== null) return
        patch(id, { deleted: 1, body: null, image_url: null })
        setPinned((p) => p.filter((x) => x.id !== id))
      },
      // a DM frame only ever reaches its two participants (sse.sendToUsers), so no filtering is needed here
      dm: ({ from, to, message }) => {
        const peer = from === me.id ? to : from
        const read = peer === dm && document.visibilityState === "visible"
        if (peer === dm) {
          if (read) markRead(message.id, peer)
          if (message.user_id === me.id || nearBottom.current) stick.current = true
          else setFresh((n) => n + 1)
          setMsgs((l) => (l?.some((x) => x.id === message.id) ? l : [...(l ?? []), message]))
        }
        void loadConvs()
        if (!read && message.user_id !== me.id) notify() // keep the sidebar badge in step with the rail
      },
      dm_deleted: ({ id, from, to }) => {
        if ((from === me.id ? to : from) === dm) patch(id, { deleted: 1, body: null, image_url: null })
        void loadConvs()
      },
      pinned: ({ id, pinned }) => {
        if (dm !== null) return
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
        void loadConvs() // per-peer unread and previews do not heal on their own after an SSE gap
      },
    },
    ready,
  )

  // switching conversation: clear the room-only filters so the DM view is never "filtered"
  const openThread = useCallback((peer: number | null) => {
    if (peer !== null && !convs.some((c) => c.id === peer))
      return void toast.error("المحادثة الخاصة متاحة بين أعضاء المجموعة فقط")
    setRailOpen(false)
    setDm((cur) => {
      if (cur === peer) return cur
      setSearch("")
      setQ("")
      setTag(null)
      return peer
    })
    if (peer === null) setRoomUnread(0)
  }, [convs])

  // ?dm= is already applied above; once the room's people are known, correct it if the peer is not one
  // of them (and strip the param either way)
  useDeepLink(["dm"], ready && convs.length > 0, (p) => {
    const peer = Number(p.get("dm")) || 0
    if (peer && !convs.some((c) => c.id === peer)) openThread(null)
  })

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
      // private uploads get their own key prefix, so a DM image can never be re-attached to the room
      image_key = (await api.upload(cq(dm === null ? "/chat/upload" : "/chat/upload?dm=1"), fd)).image_key
    }
    const m: ChatMsg = await api.post(
      cq(dm === null ? "/chat/messages" : `/chat/dm/${dm}/messages`),
      { body: body || undefined, image_key },
    )
    stick.current = true
    setMsgs((l) => (l?.some((x) => x.id === m.id) ? l : [...(l ?? []), m]))
    markRead(m.id)
    if (dm !== null) void loadConvs()
    else if (m.hashtags?.length) void loadTags()
  }

  const togglePin = (m: ChatMsg) =>
    api
      .put(cq(`/chat/messages/${m.id}/pin`), { pinned: m.pinned ? 0 : 1 })
      .then(() => {
        patch(m.id, { pinned: m.pinned ? 0 : 1 })
        void loadPinned()
        toast.success(m.pinned ? "أُلغي التثبيت" : "ثُبّتت الرسالة")
      })
      .catch((e) => toast.error(e.message))

  const remove = async () => {
    if (!deleting) return
    try {
      await api.del(cq(dm === null ? `/chat/messages/${deleting.id}` : `/chat/dm/messages/${deleting.id}`))
      patch(deleting.id, { deleted: 1, body: null, image_url: null })
      setPinned((p) => p.filter((x) => x.id !== deleting.id))
      setDeleting(null)
      if (dm !== null) void loadConvs()
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
  const peer = dm === null ? null : (convs.find((c) => c.id === dm) ?? null)
  const rail = (
    <Rail
      members={members}
      online={online}
      tags={tags}
      activeTag={tag}
      onTag={setTag}
      convs={convs}
      dm={dm}
      roomName={groupName}
      roomUnread={roomUnread}
      meId={me.id}
      onOpen={openThread}
    />
  )

  return (
    <Card className="flex h-[calc(100dvh-65px-2rem)] flex-row gap-0 overflow-hidden p-0 lg:h-[calc(100dvh-65px-4rem)]">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <div className="flex flex-wrap items-center gap-2 border-b border-secondary px-3 py-2.5 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-md text-sm font-semibold",
                peer ? ROLE_TILE[peer.role] : "bg-primary-light text-primary",
              )}
            >
              {peer ? initials(peer.name) || "؟" : <MessageSquareText className="size-5" />}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold">{peer ? peer.name : groupName || "محادثة الفريق"}</h2>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {peer ? (
                  <>
                    <Badge variant={ROLE_VARIANT[peer.role]}>{ROLE_LABEL[peer.role]}</Badge>
                    <span>{online.has(peer.id) ? "متصل الآن" : "غير متصل"}</span>
                    <span>· محادثة خاصة</span>
                  </>
                ) : (
                  <span>متصل الآن {onlineMembers.length}</span>
                )}
                {!peer && onlineMembers.length > 0 && (
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
            {dm === null && (
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
            )}
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
              المحادثات
            </Button>
          </div>
        </div>

        {/* pinned bar */}
        {dm === null && pinned.length > 0 && (
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
                  {filtered
                    ? "لا توجد رسائل مطابقة"
                    : dm !== null
                      ? `لا توجد رسائل بعد — ابدأ محادثة خاصة مع ${peer?.name ?? "زميلك"}`
                      : "ابدأ المحادثة مع فريقك — اكتب @ للإشارة إلى زميل و # لوسم الموضوع"}
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
                        onTag={dm === null ? setTag : undefined}
                        onImage={setLightbox}
                        onPin={dm === null ? togglePin : undefined}
                        onDelete={setDeleting}
                        onDm={dm === null ? openThread : undefined}
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

        <Composer key={dm ?? 0} members={members} tags={tags} onSend={send} plain={dm !== null} />
      </div>

      {/* right rail (desktop) */}
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-s border-secondary p-4 lg:block" aria-label="المحادثات وأعضاء الفريق">
        {rail}
      </aside>

      <Dialog open={railOpen} onOpenChange={setRailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>المحادثات والفريق</DialogTitle>
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
            <AlertDialogDescription>
              {dm === null
                ? "ستُحذف الرسالة من المحادثة لجميع الأعضاء ولا يمكن التراجع."
                : "ستُحذف الرسالة من المحادثة الخاصة لكلا الطرفين ولا يمكن التراجع."}
            </AlertDialogDescription>
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
