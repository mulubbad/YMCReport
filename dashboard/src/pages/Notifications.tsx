import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  AlertTriangle,
  BellOff,
  BellRing,
  CheckCheck,
  CheckCircle2,
  ClipboardPlus,
  Clock,
  MessageCircle,
  ScanSearch,
  ShieldAlert,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { ago, notify, parseUtc } from "@/components/tasks/shared"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

type Kind = "task_new" | "task_due_soon" | "task_overdue" | "task_done" | "account_stale" | "account_status" | "task_nudge" | "message"
type Item = { id: number; kind: Kind; title: string; body: string | null; link: string | null; read: number; created_at: string }

const KINDS: Record<Kind, { label: string; Icon: typeof Clock; tile: string }> = {
  task_new: { label: "مهمة جديدة", Icon: ClipboardPlus, tile: "bg-primary-light text-primary" },
  task_due_soon: { label: "تستحق قريبًا", Icon: Clock, tile: "bg-warning-light text-warning" },
  task_overdue: { label: "متأخرة", Icon: AlertTriangle, tile: "bg-danger-light text-destructive" },
  task_done: { label: "إنجاز مهمة", Icon: CheckCircle2, tile: "bg-success-light text-success" },
  account_stale: { label: "حساب يحتاج فحصًا", Icon: ScanSearch, tile: "bg-warning-light text-warning" },
  account_status: { label: "تغيّر حالة حساب", Icon: ShieldAlert, tile: "bg-danger-light text-destructive" },
  task_nudge: { label: "تذكير", Icon: BellRing, tile: "bg-warning-light text-warning" },
  message: { label: "رسالة خاصة", Icon: MessageCircle, tile: "bg-info-light text-info" },
}
const KIND_KEYS = Object.keys(KINDS) as Kind[]
const LIMIT = 30

// local YYYY-MM-DD with Latin digits (server timestamps are UTC)
const ymd = (d: Date) => d.toLocaleDateString("en-CA")
const dayLabel = (day: string) => {
  const now = new Date()
  if (day === ymd(now)) return "اليوم"
  now.setDate(now.getDate() - 1)
  return day === ymd(now) ? "أمس" : day
}

export default function Notifications() {
  const navigate = useNavigate()
  const [items, setItems] = useState<Item[] | null>(null)
  const [unread, setUnread] = useState(0)
  const [next, setNext] = useState<number | null>(null)
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [kind, setKind] = useState<Kind | "all">("all")
  const [busy, setBusy] = useState(false)

  const query = (before?: number) => {
    const q = new URLSearchParams({ limit: String(LIMIT) })
    if (before) q.set("before", String(before))
    if (onlyUnread) q.set("unread", "1")
    if (kind !== "all") q.set("kind", kind)
    return `/notifications?${q}`
  }

  // filters change → reset list and refetch
  useEffect(() => {
    let stale = false
    setItems(null)
    setNext(null)
    api
      .get(query())
      .then((r) => {
        if (stale) return
        setItems(r.items)
        setUnread(r.unread)
        setNext(r.next)
      })
      .catch((e) => toast.error(e.message))
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyUnread, kind])

  const loadMore = async () => {
    if (!next) return
    setBusy(true)
    try {
      const r = await api.get(query(next))
      setItems((prev) => [...(prev ?? []), ...r.items])
      setUnread(r.unread)
      setNext(r.next)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "حدث خطأ")
    } finally {
      setBusy(false)
    }
  }

  const open = async (n: Item) => {
    if (!n.read) {
      try {
        const r = await api.put("/notifications/read", { ids: [n.id] })
        setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, read: 1 } : x)) ?? null)
        setUnread(r.unread)
        notify()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "حدث خطأ")
      }
    }
    if (n.link) navigate(n.link)
  }

  const readAll = async () => {
    setBusy(true)
    try {
      const r = await api.put("/notifications/read", { all: true })
      setItems((prev) => prev?.map((x) => ({ ...x, read: 1 })) ?? null)
      setUnread(r.unread)
      notify()
      toast.success("تم تحديد الكل كمقروء")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "حدث خطأ")
    } finally {
      setBusy(false)
    }
  }

  const filtered = onlyUnread || kind !== "all"
  const clearFilters = () => {
    setOnlyUnread(false)
    setKind("all")
  }

  // group consecutive rows by local day (list is already newest-first)
  const groups: { day: string; rows: Item[] }[] = []
  for (const n of items ?? []) {
    const day = ymd(parseUtc(n.created_at))
    const g = groups[groups.length - 1]
    if (g?.day === day) g.rows.push(n)
    else groups.push({ day, rows: [n] })
  }

  const chip = (label: string, on: boolean, onClick: () => void) => (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "min-h-9 cursor-pointer rounded-btn px-3 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        on ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-primary-light hover:text-primary"
      )}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-4">
      <Card className="gap-0 py-0">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b px-4 py-4 md:px-6 [.border-b]:pb-4">
          <div>
            <div className="text-[1.05rem] font-bold">الإشعارات</div>
            <div className="text-xs text-muted-foreground">
              {items ? `${unread} غير مقروء` : "جارٍ التحميل…"}
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="flex gap-1" role="group" aria-label="تصفية القراءة">
              {chip("الكل", !onlyUnread, () => setOnlyUnread(false))}
              {chip("غير المقروءة", onlyUnread, () => setOnlyUnread(true))}
            </div>
            <Select value={kind} onValueChange={(v) => setKind(v as Kind | "all")}>
              <SelectTrigger className="w-full sm:w-44" aria-label="نوع الإشعار">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأنواع</SelectItem>
                {KIND_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KINDS[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="light" className="w-full sm:w-auto" disabled={busy || unread === 0} onClick={readAll}>
              <CheckCheck />
              تحديد الكل كمقروء
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {!items ? (
            <div className="space-y-3 p-4 md:p-6">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-9 shrink-0 rounded-md" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center">
              <div className="flex size-14 items-center justify-center rounded-lg bg-info-light text-info">
                <BellOff className="size-7" />
              </div>
              <p className="text-sm text-muted-foreground">
                {filtered ? "لا توجد إشعارات مطابقة" : "لا توجد إشعارات"}
              </p>
              {filtered && (
                <Button variant="outline" onClick={clearFilters}>
                  <X />
                  مسح التصفية
                </Button>
              )}
            </div>
          ) : (
            <>
              {groups.map((g) => (
                <section key={g.day} aria-label={dayLabel(g.day)}>
                  <div className="sticky top-0 z-10 border-b border-dashed bg-card px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase md:px-6">
                    {dayLabel(g.day)}
                  </div>
                  <ul className="divide-y divide-dashed">
                    {g.rows.map((n) => {
                      const { Icon, tile, label } = KINDS[n.kind]
                      const isUnread = !n.read
                      return (
                        <li key={n.id}>
                          <button
                            type="button"
                            onClick={() => open(n)}
                            className={cn(
                              "flex w-full min-h-11 cursor-pointer items-start gap-3 px-4 py-3 text-start transition-colors duration-150 outline-none hover:bg-gray-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset md:px-6 dark:hover:bg-muted",
                              isUnread && "bg-primary-light/60"
                            )}
                          >
                            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md", tile)} aria-label={label}>
                              <Icon className="size-[18px]" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={cn("block truncate text-sm", isUnread ? "font-semibold" : "font-medium")}>
                                {n.title}
                              </span>
                              {n.body && (
                                <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>
                              )}
                              <span className="mt-1 block text-xs text-muted-foreground tabular-nums">{ago(n.created_at)}</span>
                            </span>
                            {isUnread && (
                              <span className="mt-2 size-2 shrink-0 rounded-full bg-primary">
                                <span className="sr-only">غير مقروء</span>
                              </span>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
              {next && (
                <div className="flex justify-center border-t border-dashed p-4">
                  <Button variant="outline" className="w-full sm:w-auto" disabled={busy} onClick={loadMore}>
                    تحميل المزيد
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
