import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import {
  Activity,
  ArrowUpDown,
  AtSign,
  CalendarClock,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  FileText,
  Percent,
  Timer,
  TriangleAlert,
  Users,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { KINDS, ago, arDays, initials, type Kind } from "@/components/tasks/shared"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useScope } from "@/lib/scope"
import { cn } from "@/lib/utils"

// ---- contract shapes (CONTRACT.md "Manager dashboard") ------------------------------------------
type Status = "active" | "restricted" | "suspended" | "closed"
type Series = { date: string; created: number; completed: number }
type Group = {
  id: number; name: string; members: number; accounts: number; tasks: number
  completion: number; on_time_rate: number; overdue: number; attention: number; health: number
}
type MemberRow = {
  id: number; name: string; group_name: string | null; done: number; total: number
  completion: number; on_time_rate: number; overdue: number; attention: number
}
type Attention = { type: "task" | "account"; id: number; title: string; detail: string; severity: "danger" | "warning"; link: string }
type Recent = { id: number; kind: string; summary: string; account_name: string; actor_name: string; created_at: string }
type Detail = {
  range: { from: string; to: string }
  kpis: {
    tasks_created: number; completions: number; completion_rate: number; on_time_rate: number; overdue: number
    due_soon: number; avg_overdue_days: number; active_members: number; accounts_by_status: Partial<Record<Status, number>>
  }
  series: Series[]
  tasks_by_kind: { kind: Kind; total: number; completion: number }[]
  groups: Group[]
  members: MemberRow[]
  attention: Attention[]
  recent: Recent[]
}
type Stats = {
  users: number; accounts: number; pages: number; tasks: number; completion: number
  my_pending?: number; accounts_attention: number; accounts_by_type: { name: string; count: number }[]
  detail?: Detail
}

// ---- small helpers -------------------------------------------------------------------------------
const ymd = (d: Date) => d.toLocaleDateString("en-CA")
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return ymd(d) }
const VALID = /^\d{4}-\d{2}-\d{2}$/
const fmt = (s: string, o: Intl.DateTimeFormatOptions) =>
  new Date(s + "T00:00:00Z").toLocaleDateString("ar", { ...o, timeZone: "UTC", numberingSystem: "latn" })
const pct = (n: number) => `${Math.round(n)}%`

const presetsFor = (today: string) => [
  { label: "7 أيام", from: addDays(today, -6), to: today },
  { label: "30 يوماً", from: addDays(today, -29), to: today },
  { label: "90 يوماً", from: addDays(today, -89), to: today },
  { label: "هذا الشهر", from: today.slice(0, 8) + "01", to: today },
]

const STATUS: Record<Status, { label: string; variant: "success" | "warning" | "danger" | "secondary" }> = {
  active: { label: "نشط", variant: "success" },
  restricted: { label: "مقيّد", variant: "warning" },
  suspended: { label: "موقوف", variant: "danger" },
  closed: { label: "مغلق", variant: "secondary" },
}
const EVENT: Record<string, string> = {
  created: "إنشاء", updated: "تعديل", status: "تغيير الحالة", metrics: "تحديث الإحصائيات", note: "ملاحظة",
  page_created: "إضافة صفحة", page_updated: "تعديل صفحة", page_deleted: "حذف صفحة", checked: "فحص",
}
const BAR: Record<string, string> = { "primary-light": "bg-primary", success: "bg-success", warning: "bg-warning-fill", info: "bg-info" }
const healthOf = (h: number) =>
  h >= 80 ? { label: "ممتاز", variant: "success" as const, stroke: "text-success" }
  : h >= 60 ? { label: "جيد", variant: "primary-light" as const, stroke: "text-primary" }
  : h >= 40 ? { label: "يحتاج متابعة", variant: "warning" as const, stroke: "text-warning" }
  : { label: "حرج", variant: "danger" as const, stroke: "text-destructive" }

// ---- entry: members keep the simple view, managers get the range view ---------------------------
export default function Dashboard() {
  const { user } = useAuth()
  return user?.role === "user" ? <SimpleView /> : <ManagerView isSuper={user?.role === "super"} />
}

// ---- member view (unchanged behavior) ------------------------------------------------------------
function SimpleView({ preloaded }: { preloaded?: Stats }) {
  const [stats, setStats] = useState<Stats | null>(preloaded ?? null)

  useEffect(() => {
    if (!preloaded) api.get("/stats").then(setStats).catch((e) => toast.error(e.message))
  }, [preloaded])

  const cards = stats
    ? [
        { label: "المستخدمون", value: String(stats.users), icon: Users, tint: "bg-primary-light text-primary" },
        { label: "الحسابات", value: String(stats.accounts), icon: AtSign, tint: "bg-success-light text-success" },
        { label: "الصفحات", value: String(stats.pages), icon: FileText, tint: "bg-info-light text-info" },
        { label: "المهام", value: String(stats.tasks), icon: ClipboardList, tint: "bg-warning-light text-warning" },
        { label: "نسبة الإنجاز", value: `${stats.completion}%`, icon: Percent, tint: "bg-primary-light text-primary" },
        { label: "تحتاج متابعة", value: String(stats.accounts_attention ?? 0), icon: TriangleAlert, tint: "bg-danger-light text-destructive" },
      ]
    : null

  const max = Math.max(1, ...(stats?.accounts_by_type.map((t) => t.count) ?? []))

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">نظرة عامة على المستخدمين والحسابات والمهام.</p>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {cards
          ? cards.map(({ label, value, icon: Icon, tint }) => (
              <Card key={label} className="gap-4 py-5">
                <CardContent className="space-y-4 px-5">
                  <div className={`flex size-11 items-center justify-center rounded-lg ${tint}`}>
                    <Icon className="size-5" />
                  </div>
                  <div>
                    <div className="text-[1.75rem] font-bold leading-tight tabular-nums">{value}</div>
                    <div className="text-sm text-muted-foreground">{label}</div>
                  </div>
                </CardContent>
              </Card>
            ))
          : Array.from({ length: 6 }, (_, i) => <TileSkeleton key={i} />)}
      </div>

      <Card className="gap-0 py-0">
        <CardHeader>
          <CardTitle>الحسابات حسب النوع</CardTitle>
          <CardDescription>{stats ? `${stats.accounts_by_type.length} نوع` : " "}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!stats ? (
            Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-1.5 w-full" />
                </div>
              </div>
            ))
          ) : stats.accounts_by_type.length === 0 ? (
            <Empty icon={AtSign} text="لا توجد حسابات بعد — ستظهر الحسابات هنا حسب النوع فور إضافتها." />
          ) : (
            stats.accounts_by_type.map((t) => (
              <div key={t.name} className="flex items-center gap-3 text-sm">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-light text-sm font-semibold text-primary">
                  {t.name.trim().slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-semibold">{t.name}</span>
                    <span className="tabular-nums text-muted-foreground">{t.count}</span>
                  </div>
                  <Bar value={(t.count / max) * 100} cls="bg-primary" />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ---- manager view --------------------------------------------------------------------------------
function ManagerView({ isSuper }: { isSuper: boolean }) {
  const today = useMemo(() => ymd(new Date()), [])
  const presets = useMemo(() => presetsFor(today), [today])
  const [from, setFrom] = useState(presets[1].from)
  const [to, setTo] = useState(presets[1].to)
  // the group comes from the workspace switcher; api.ts puts it on every request
  const { gid } = useScope()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)

  useEffect(() => {
  }, [isSuper])

  const rangeOk = VALID.test(from) && VALID.test(to) && from <= to
  useEffect(() => {
    if (!rangeOk) return
    const id = ++seq.current
    setLoading(true)
    api
      .get(`/stats?from=${from}&to=${to}`)
      .then((s) => { if (id === seq.current) { setStats(s); setLoading(false) } })
      .catch((e) => { if (id === seq.current) { toast.error(e.message); setLoading(false) } })
  }, [from, to, gid, rangeOk])

  // backend without `detail` (older build) → plain member view with the same payload
  if (stats && !stats.detail) return <SimpleView preloaded={stats} />

  const d = stats?.detail
  const k = d?.kpis
  const tiles = k && stats
    ? [
        { label: "مهام جديدة", value: String(k.tasks_created), caption: "أُنشئت خلال الفترة", icon: ClipboardList, tint: "bg-primary-light text-primary" },
        { label: "إنجازات", value: String(k.completions), caption: "اكتمالات الأعضاء خلال الفترة", icon: CircleCheck, tint: "bg-success-light text-success" },
        { label: "نسبة الاكتمال", value: pct(k.completion_rate), caption: "من المهام المسندة", icon: Percent, tint: "bg-primary-light text-primary" },
        { label: "في الوقت", value: pct(k.on_time_rate), caption: "اكتملت قبل موعدها", icon: Timer, tint: "bg-success-light text-success" },
        { label: "متأخرة", value: String(k.overdue), caption: k.overdue ? `بمتوسط تأخير ${arDays(Math.round(k.avg_overdue_days))}` : "لا تأخير حالياً", icon: TriangleAlert, tint: "bg-danger-light text-destructive" },
        { label: "تستحق قريباً", value: String(k.due_soon), caption: "لم تكتمل بعد", icon: CalendarClock, tint: "bg-warning-light text-warning" },
        { label: "أعضاء نشطون", value: String(k.active_members), caption: "أنجزوا خلال الفترة", icon: Users, tint: "bg-info-light text-info" },
        { label: "حسابات تحتاج متابعة", value: String(stats.accounts_attention ?? 0), caption: "الآن، بغضّ النظر عن الفترة", icon: AtSign, tint: "bg-danger-light text-destructive" },
      ]
    : null
  const groupsList = d?.groups ?? []

  return (
    <div className="space-y-6" aria-busy={loading}>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">أداء الفريق خلال الفترة المحددة — غيّر النطاق من الشريط لتحديث كل الأقسام.</p>
        <Button asChild variant="light" className="ms-auto min-h-10">
          <Link to="/export"><FileText />فتح التقارير</Link>
        </Button>
      </div>

      {/* SIGNATURE — نبض الفريق: the strip is the filter */}
      <Card className="gap-0 py-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Activity className="size-5 text-primary" />نبض الفريق</CardTitle>
          <CardAction className="flex-wrap" role="group" aria-label="نطاق زمني سريع">
            {presets.map((p) => {
              const on = p.from === from && p.to === to
              return (
                <button
                  key={p.label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => { setFrom(p.from); setTo(p.to) }}
                  className={cn(
                    "min-h-11 rounded-btn px-3 text-xs font-semibold transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-9",
                    on ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-primary-light hover:text-primary",
                  )}
                >
                  {p.label}
                </button>
              )
            })}
          </CardAction>
          <div className="flex basis-full flex-wrap items-end gap-2 pt-1">
            <label className="flex w-full flex-col gap-1 text-xs text-muted-foreground sm:w-40">
              من
              <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-11 sm:h-9" />
            </label>
            <label className="flex w-full flex-col gap-1 text-xs text-muted-foreground sm:w-40">
              إلى
              <Input type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} className="h-11 sm:h-9" />
            </label>
            {!rangeOk && <span className="text-xs text-destructive">اختر تاريخين صالحين بحيث «من» لا يتجاوز «إلى».</span>}
          </div>
        </CardHeader>
        <CardContent className={cn("transition-opacity duration-300", loading && "opacity-60")}>
          {!d ? <Skeleton className="h-52 w-full" /> : <Strip series={d.series ?? []} />}
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {tiles
          ? tiles.map(({ label, value, caption, icon: Icon, tint }) => (
              <Card key={label} className="gap-4 py-5">
                <CardContent className="flex items-start gap-3 px-5">
                  <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${tint}`}>
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-2xl font-bold leading-tight tabular-nums">{value}</div>
                    <div className="truncate text-sm font-medium">{label}</div>
                    <div className="truncate text-xs text-muted-foreground">{caption}</div>
                  </div>
                </CardContent>
              </Card>
            ))
          : Array.from({ length: 8 }, (_, i) => <TileSkeleton key={i} />)}
      </div>

      {/* group health */}
      <Card className="gap-0 py-0">
        <CardHeader>
          <CardTitle>صحة المجموعات</CardTitle>
          <CardDescription>مؤشر من 100: 40% اكتمال · 30% في الوقت · 20% بلا تأخير · 10% حسابات سليمة</CardDescription>
        </CardHeader>
        <CardContent>
          {!d ? (
            <Skeleton className="h-28 w-full" />
          ) : groupsList.length === 0 ? (
            <Empty icon={Users} text="لا توجد مجموعات في هذا النطاق — أنشئ مجموعة وأضف أعضاءها أولاً." />
          ) : (
            <div className={cn("grid gap-4", groupsList.length > 1 && "md:grid-cols-2 xl:grid-cols-3")}>
              {groupsList.map((g) => {
                const h = healthOf(g.health ?? 0)
                return (
                  <div key={g.id} className="flex items-center gap-4 rounded-lg border border-dashed p-4">
                    <Ring value={Math.round(g.health ?? 0)} cls={h.stroke} />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-semibold">{g.name}</span>
                        <Badge variant={h.variant}>{h.label}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">{g.members} أعضاء · {g.accounts} حسابات</div>
                      <dl className="grid grid-cols-4 gap-2 text-center text-xs">
                        {[
                          ["المهام", String(g.tasks)],
                          ["الاكتمال", pct(g.completion)],
                          ["في الوقت", pct(g.on_time_rate)],
                          ["متأخرة", String(g.overdue)],
                        ].map(([l, v]) => (
                          <div key={l} className="rounded-md bg-muted px-1 py-1.5">
                            <dt className="text-muted-foreground">{l}</dt>
                            <dd className="font-semibold tabular-nums">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="gap-0 py-0 xl:col-span-2">
          <CardHeader>
            <CardTitle>الأعضاء</CardTitle>
            <CardDescription>أعلى 20 عضواً حسب الاكتمال — اضغط عنوان العمود للترتيب</CardDescription>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            {!d ? (
              <div className="space-y-3 p-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (d.members ?? []).length === 0 ? (
              <div className="p-4"><Empty icon={Users} text="لا يوجد أعضاء لديهم مهام في هذه الفترة — وسّع النطاق الزمني." /></div>
            ) : (
              <MembersTable members={d.members} />
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="gap-0 py-0">
            <CardHeader>
              <CardTitle>المهام حسب النوع</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!d ? (
                Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)
              ) : (d.tasks_by_kind ?? []).length === 0 ? (
                <Empty icon={ClipboardList} text="لا توجد مهام في هذه الفترة — وسّع النطاق الزمني." />
              ) : (
                <KindBars rows={d.tasks_by_kind} />
              )}
            </CardContent>
          </Card>

          <Card className="gap-0 py-0">
            <CardHeader>
              <CardTitle>الحسابات حسب الحالة</CardTitle>
            </CardHeader>
            <CardContent>
              {!k ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2">
                  {(Object.keys(STATUS) as Status[]).map((s) => (
                    <div key={s} className="space-y-1 rounded-lg border border-dashed p-3">
                      <div className="text-xl font-bold tabular-nums">{k.accounts_by_status?.[s] ?? 0}</div>
                      <Badge variant={STATUS[s].variant}>{STATUS[s].label}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="gap-0 py-0">
          <CardHeader>
            <CardTitle>يحتاج انتباهك</CardTitle>
            <CardDescription>مهام متأخرة وحسابات غير نشطة أو لم تُفحص منذ مدة</CardDescription>
          </CardHeader>
          <CardContent className="p-2 sm:p-3">
            {!d ? (
              <div className="space-y-2 p-2">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : (d.attention ?? []).length === 0 ? (
              <div className="p-2"><Empty icon={CircleCheck} tint="bg-success-light text-success" text="كل شيء على ما يرام — لا توجد عناصر تحتاج متابعة الآن." /></div>
            ) : (
              <AttentionList rows={d.attention} />
            )}
          </CardContent>
        </Card>

        <Card className="gap-0 py-0">
          <CardHeader>
            <CardTitle>آخر النشاط</CardTitle>
            <CardDescription>آخر 10 أحداث على الحسابات ضمن النطاق</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!d ? (
              Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)
            ) : (d.recent ?? []).length === 0 ? (
              <Empty icon={AtSign} text="لا يوجد نشاط على الحسابات في هذه الفترة — وسّع النطاق الزمني." />
            ) : (
              d.recent.map((r) => (
                <div key={r.id} className="flex items-start gap-3 text-sm">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-light text-xs font-semibold text-primary">
                    {initials(r.actor_name || "؟")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{r.summary}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[r.account_name, r.actor_name, EVENT[r.kind] ?? r.kind, ago(r.created_at)].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ---- signature: day-by-day SVG strip ------------------------------------------------------------
type Col = Series & { to?: string }
// ponytail: > 60 days → weekly buckets client-side so 375px stays readable; no zoom/pan
const bucket = (series: Series[]): Col[] =>
  series.length <= 60
    ? series
    : Array.from({ length: Math.ceil(series.length / 7) }, (_, i) => {
        const w = series.slice(i * 7, i * 7 + 7)
        return {
          date: w[0].date,
          to: w[w.length - 1].date,
          created: w.reduce((a, s) => a + s.created, 0),
          completed: w.reduce((a, s) => a + s.completed, 0),
        }
      })

function Strip({ series }: { series: Series[] }) {
  const cols = useMemo(() => bucket(series), [series])
  const n = cols.length
  const max = Math.max(1, ...cols.map((c) => Math.max(c.created, c.completed)))
  const totals = cols.reduce((a, c) => ({ created: a.created + c.created, completed: a.completed + c.completed }), { created: 0, completed: 0 })
  const [active, setActive] = useState<number | null>(null)
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    // one 300ms bar-grow on mount (global reduced-motion rule zeroes the transition)
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  useEffect(() => setActive(null), [series])

  if (n === 0 || totals.created + totals.completed === 0)
    return <Empty icon={Activity} text="لا توجد مهام في هذه الفترة — وسّع النطاق الزمني." />

  const weekly = cols[0].to !== undefined
  const step = Math.ceil(n / 7)
  const h = (v: number) => (grown ? (v / max) * 100 : 0)
  const clamp = (i: number) => Math.min(n - 1, Math.max(0, i))
  // SVG x-axis is physical (oldest left → newest right), so the newest day sits at the logical start in RTL;
  // ticks/tooltip therefore use physical `left` to line up with the bars.
  const pickX = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setActive(clamp(Math.floor(((e.clientX - r.left) / r.width) * n)))
  }
  const onKey = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const cur = active ?? n - 1
    const next = e.key === "ArrowRight" ? cur + 1 : e.key === "ArrowLeft" ? cur - 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null
    if (next === null) return
    e.preventDefault()
    setActive(clamp(next))
  }
  const label = (c: Col) =>
    c.to ? `${fmt(c.date, { day: "numeric", month: "short" })} – ${fmt(c.to, { day: "numeric", month: "short" })}`
    : fmt(c.date, { weekday: "long", day: "numeric", month: "long" })
  const a = active === null ? null : cols[active]
  const left = active === null ? 0 : ((active + 0.5) / n) * 100

  return (
    <div>
      <div className="relative pt-12">
        {a && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 max-w-[80%] whitespace-nowrap rounded-md border bg-popover px-3 py-1.5 text-xs shadow-md"
            style={left < 20 ? { left: 0 } : left > 80 ? { right: 0 } : { left: `${left}%`, transform: "translateX(-50%)" }}
          >
            <div className="font-semibold">{label(a)}</div>
            <div className="tabular-nums text-muted-foreground">إنجازات {a.completed} · مهام جديدة {a.created}</div>
          </div>
        )}
        <svg
          viewBox={`0 0 ${n} 100`}
          preserveAspectRatio="none"
          className="block h-40 w-full rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-48"
          tabIndex={0}
          role="img"
          aria-label={`نشاط الفريق يوماً بيوم: ${totals.completed} إنجازاً و${totals.created} مهمة جديدة خلال الفترة. استخدم الأسهم للتنقل بين الأيام.`}
          onMouseMove={pickX}
          onMouseLeave={() => setActive(null)}
          onFocus={() => setActive((i) => i ?? n - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={onKey}
        >
          {active !== null && <rect x={active} y={0} width={1} height={100} className="fill-primary/10" />}
          {cols.map((c, i) => (
            <g key={c.date}>
              <rect x={i + 0.12} width={0.76} y={100 - h(c.created)} height={h(c.created)} className="fill-primary/20" style={{ transition: "y .3s, height .3s" }} />
              <rect x={i + 0.3} width={0.4} y={100 - h(c.completed)} height={h(c.completed)} className="fill-primary" style={{ transition: "y .3s, height .3s" }} />
            </g>
          ))}
          <rect x={0} y={99.5} width={n} height={0.5} className="fill-border" />
        </svg>
        <div className="relative h-5 text-[11px] text-muted-foreground">
          {cols.map((c, i) =>
            (n - 1 - i) % step === 0 ? (
              <span key={c.date} className="absolute top-1 -translate-x-1/2 whitespace-nowrap tabular-nums" style={{ left: `${((i + 0.5) / n) * 100}%` }}>
                {n <= 7 ? fmt(c.date, { weekday: "short" }) : fmt(c.date, { day: "numeric", month: "short" })}
              </span>
            ) : null,
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-primary" aria-hidden />إنجازات <b className="tabular-nums text-foreground">{totals.completed}</b></span>
        <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-primary/20" aria-hidden />مهام جديدة <b className="tabular-nums text-foreground">{totals.created}</b></span>
        {weekly && <span className="ms-auto">مجمّعة أسبوعياً</span>}
      </div>
    </div>
  )
}

// ---- sections ------------------------------------------------------------------------------------
type SortKey = "completion" | "on_time_rate" | "overdue"
const COLS: [SortKey, string][] = [["completion", "الاكتمال"], ["on_time_rate", "في الوقت"], ["overdue", "متأخرة"]]

function MembersTable({ members }: { members: MemberRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "completion", desc: true })
  const rows = useMemo(
    () => [...members].sort((a, b) => (sort.desc ? b[sort.key] - a[sort.key] : a[sort.key] - b[sort.key])),
    [members, sort],
  )
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-10 ps-4 sm:ps-6">#</TableHead>
          <TableHead>العضو</TableHead>
          {COLS.map(([key, label]) => (
            <TableHead key={key} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
              <button
                type="button"
                onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}
                className={cn("inline-flex min-h-10 items-center gap-1 rounded-md uppercase outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50", sort.key === key && "text-foreground")}
              >
                {label}
                <ArrowUpDown className="size-3" aria-hidden />
              </button>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((m, i) => (
          <TableRow key={m.id}>
            <TableCell className="ps-4 text-xs text-muted-foreground tabular-nums sm:ps-6">{i + 1}</TableCell>
            <TableCell>
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-light text-xs font-semibold text-primary">{initials(m.name)}</div>
                <div className="min-w-0">
                  <div className="max-w-[9rem] truncate font-semibold sm:max-w-none">{m.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{m.group_name ?? "بلا مجموعة"}</div>
                </div>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <div className="w-14 sm:w-24"><Bar value={m.completion} cls="bg-success" /></div>
                <span className="tabular-nums">{pct(m.completion)}</span>
                <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">{m.done}/{m.total}</span>
              </div>
            </TableCell>
            <TableCell className="tabular-nums">{pct(m.on_time_rate)}</TableCell>
            <TableCell className={cn("tabular-nums", m.overdue > 0 && "font-semibold text-destructive")}>{m.overdue}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function KindBars({ rows }: { rows: Detail["tasks_by_kind"] }) {
  const max = Math.max(1, ...rows.map((r) => r.total))
  return (
    <>
      {rows.map((r) => {
        const K = KINDS[r.kind] ?? KINDS.general
        return (
          <div key={r.kind} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-sm">
              <Badge variant={K.variant}>{K.label}</Badge>
              <span className="tabular-nums text-muted-foreground">{r.total} مهمة · اكتمال {pct(r.completion)}</span>
            </div>
            <Bar value={(r.total / max) * 100} cls={BAR[K.variant]} />
          </div>
        )
      })}
    </>
  )
}

function AttentionList({ rows }: { rows: Attention[] }) {
  const navigate = useNavigate()
  return (
    <ul className="divide-y divide-dashed">
      {rows.map((r) => {
        const danger = r.severity === "danger"
        return (
          <li key={`${r.type}-${r.id}`}>
            <button
              type="button"
              onClick={() => navigate(r.link)}
              className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 py-2 text-start outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", danger ? "bg-danger-light text-destructive" : "bg-warning-light text-warning")}>
                {danger ? <CircleAlert className="size-5" /> : <TriangleAlert className="size-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{r.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{r.type === "task" ? "مهمة" : "حساب"} · {r.detail}</span>
              </span>
              <ChevronLeft className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// ---- primitives ----------------------------------------------------------------------------------
function Ring({ value, cls }: { value: number; cls: string }) {
  const r = 28
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 72 72" className="size-[72px] shrink-0" role="img" aria-label={`مؤشر الصحة ${value} من 100`}>
      <circle cx="36" cy="36" r={r} fill="none" strokeWidth="6" className="stroke-border" />
      <circle
        cx="36" cy="36" r={r} fill="none" strokeWidth="6" strokeLinecap="round" stroke="currentColor"
        className={cls} strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, Math.max(0, value)) / 100)} transform="rotate(-90 36 36)"
      />
      <text x="36" y="37" textAnchor="middle" dominantBaseline="central" className="fill-foreground text-base font-bold tabular-nums">{value}</text>
    </svg>
  )
}

function Bar({ value, cls }: { value: number; cls: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-muted">
      <div className={cn("h-1.5 rounded-full", cls)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  )
}

function Empty({ icon: Icon, text, tint = "bg-primary-light text-primary" }: { icon: typeof AtSign; text: string; tint?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <div className={cn("flex size-12 items-center justify-center rounded-lg", tint)}>
        <Icon className="size-6" />
      </div>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  )
}

function TileSkeleton() {
  return (
    <Card className="gap-4 py-5">
      <CardContent className="space-y-4 px-5">
        <Skeleton className="size-11 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-14" />
          <Skeleton className="h-4 w-20" />
        </div>
      </CardContent>
    </Card>
  )
}
