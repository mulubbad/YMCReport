import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import {
  AlertTriangle,
  AtSign,
  Bell,
  BellOff,
  BellPlus,
  BellRing,
  CheckCircle2,
  ClipboardPlus,
  Clock,
  MessageCircle,
  ScanSearch,
  ShieldAlert,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { enablePush, pushState, syncPush } from "@/lib/push"
import { cn } from "@/lib/utils"

export type Notification = {
  id: number
  kind: keyof typeof KINDS
  title: string
  body: string | null
  link: string | null
  read: 0 | 1
  created_at: string
}

export const KINDS = {
  task_new: { label: "مهمة جديدة", icon: ClipboardPlus, tone: "bg-primary-light text-primary" },
  task_due_soon: { label: "تستحق قريبًا", icon: Clock, tone: "bg-warning-light text-warning" },
  task_overdue: { label: "متأخرة", icon: AlertTriangle, tone: "bg-danger-light text-destructive" },
  task_done: { label: "إنجاز مهمة", icon: CheckCircle2, tone: "bg-success-light text-success" },
  account_stale: { label: "حساب يحتاج فحصًا", icon: ScanSearch, tone: "bg-warning-light text-warning" },
  account_status: { label: "تغيّر حالة حساب", icon: ShieldAlert, tone: "bg-danger-light text-destructive" },
  task_nudge: { label: "تذكير", icon: BellRing, tone: "bg-warning-light text-warning" },
  message: { label: "رسالة خاصة", icon: MessageCircle, tone: "bg-info-light text-info" },
  mention: { label: "إشارة إليك", icon: AtSign, tone: "bg-primary-light text-primary" },
} as const

const BASE_TITLE = "YMCReport — نظام متابعة الأعمال"
const POLL_MS = 30_000

export function ago(iso: string) {
  const t = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z").getTime()
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000))
  if (m < 1) return "الآن"
  if (m < 60) return m === 1 ? "منذ دقيقة" : m === 2 ? "منذ دقيقتين" : `منذ ${m} دقيقة`
  const h = Math.round(m / 60)
  if (h < 24) return h === 1 ? "منذ ساعة" : h === 2 ? "منذ ساعتين" : `منذ ${h} ساعة`
  const d = Math.round(h / 24)
  return d === 1 ? "منذ يوم" : d === 2 ? "منذ يومين" : `منذ ${d} يوم`
}

export function KindIcon({ kind, className }: { kind: Notification["kind"]; className?: string }) {
  const k = KINDS[kind] ?? KINDS.task_new
  const Icon = k.icon
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md", k.tone, className)}>
      <Icon className="size-4" />
    </span>
  )
}

// Polls /notifications while the tab is visible; toasts items that arrived since the previous fetch.
export function useNotifications() {
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const lastMax = useRef<number | null>(null) // null = nothing fetched yet → never toast on first load
  const navigate = useNavigate()

  const fetchAll = useCallback(async () => {
    try {
      const d = await api.get("/notifications?limit=30")
      const list: Notification[] = d.items ?? []
      const max = list.reduce((m, n) => Math.max(m, n.id), 0)
      if (lastMax.current !== null) {
        const fresh = list.filter((n) => !n.read && n.id > lastMax.current!)
        fresh.slice(0, 3).forEach((n) =>
          toast(n.title, {
            description: n.body ?? undefined,
            icon: <KindIcon kind={n.kind} className="size-7" />,
            action: n.link ? { label: "فتح", onClick: () => navigate(n.link!) } : undefined,
          }),
        )
        if (fresh.length > 3) toast(`+${fresh.length - 3} إشعارات أخرى`)
      }
      lastMax.current = Math.max(max, lastMax.current ?? 0)
      setItems(list)
      setUnread(d.unread ?? 0)
    } catch {
      /* offline/expired — next poll retries */
    } finally {
      setLoading(false)
    }
  }, [navigate])

  useEffect(() => {
    let timer: number | undefined
    const start = () => {
      void fetchAll()
      timer = window.setInterval(fetchAll, POLL_MS)
    }
    const stop = () => window.clearInterval(timer)
    const onVis = () => (document.visibilityState === "visible" ? start() : stop())
    if (document.visibilityState === "visible") start()
    document.addEventListener("visibilitychange", onVis)
    window.addEventListener("ymc:refresh", fetchAll)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVis)
      window.removeEventListener("ymc:refresh", fetchAll)
    }
  }, [fetchAll])

  // service worker → page: a push arrived (refetch + toast via ymc:refresh) / OS notification clicked (navigate)
  useEffect(() => {
    const sw = navigator.serviceWorker
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "push") window.dispatchEvent(new Event("ymc:refresh"))
      if (e.data?.type === "navigate" && typeof e.data.link === "string") navigate(e.data.link)
    }
    sw?.addEventListener("message", onMsg)
    return () => sw?.removeEventListener("message", onMsg)
  }, [navigate])

  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE
  }, [unread])

  const markRead = useCallback(async (ids: number[] | "all") => {
    const d = await api.put("/notifications/read", ids === "all" ? { all: true } : { ids })
    setItems((list) => list.map((n) => (ids === "all" || ids.includes(n.id) ? { ...n, read: 1 } : n)))
    setUnread(d.unread ?? 0)
  }, [])

  return { items, unread, loading, markRead, refresh: fetchAll }
}

export function NotificationBell() {
  const { items, unread, loading, markRead } = useNotifications()
  const navigate = useNavigate()
  const [push, setPush] = useState(pushState)
  useEffect(syncPush, [])
  const enable = async () => {
    try {
      if (await enablePush()) toast.success("تم تفعيل تنبيهات الجهاز")
      else toast.error("لم يُسمح بالتنبيهات من المتصفح")
    } catch (e) {
      toast.error((e as Error).message)
    }
    setPush(pushState())
  }
  const open = async (n: Notification) => {
    if (!n.read) await markRead([n.id]).catch(() => {})
    if (n.link) navigate(n.link)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-lg"
          className="relative"
          aria-label={`الإشعارات، ${unread} غير مقروء`}
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span
              aria-live="polite"
              className="absolute top-1 end-1 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] leading-4 font-semibold text-white"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(92vw,360px)] p-0">
        <div className="flex items-center gap-2 border-b border-secondary px-4 py-3">
          <span className="font-semibold">الإشعارات</span>
          {unread > 0 && <Badge variant="primary-light">{unread}</Badge>}
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="ms-auto h-8 text-xs"
              onClick={() => void markRead("all")}
            >
              تحديد الكل كمقروء
            </Button>
          )}
        </div>
        {push === "default" && (
          <button
            type="button"
            onClick={() => void enable()}
            className="flex w-full items-center gap-3 border-b border-secondary bg-primary-light/60 px-4 py-2.5 text-start text-xs hover:bg-primary-light"
          >
            <BellPlus className="size-4 shrink-0 text-primary" />
            <span className="flex-1">فعّل تنبيهات الجهاز لتصلك الإشعارات فورًا حتى عند إغلاق التطبيق</span>
            <span className="font-semibold text-primary">تفعيل</span>
          </button>
        )}
        <div className="max-h-[60vh] overflow-y-auto">
          {loading && items.length === 0 ? (
            Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex gap-3 px-4 py-3">
                <Skeleton className="size-9 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-sm text-muted-foreground">
              <span className="flex size-11 items-center justify-center rounded-md bg-muted">
                <BellOff className="size-5" />
              </span>
              لا توجد إشعارات
            </div>
          ) : (
            items.map((n) => (
              <DropdownMenuItem
                key={n.id}
                onSelect={() => void open(n)}
                className={cn(
                  "min-h-11 cursor-pointer items-start gap-3 rounded-none border-b border-dashed border-secondary px-4 py-3",
                  !n.read && "bg-primary-light/40",
                )}
              >
                <KindIcon kind={n.kind} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm", !n.read && "font-semibold")}>{n.title}</span>
                  {n.body && (
                    <span className="line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>
                  )}
                  <span className="block text-[11px] text-muted-foreground">{ago(n.created_at)}</span>
                </span>
                {!n.read && (
                  <span className="mt-2 size-2 shrink-0 rounded-full bg-primary">
                    <span className="sr-only">غير مقروء</span>
                  </span>
                )}
              </DropdownMenuItem>
            ))
          )}
        </div>
        <div className="border-t border-secondary p-2">
          <Button asChild variant="light" className="w-full">
            <Link to="/notifications">عرض كل الإشعارات</Link>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
