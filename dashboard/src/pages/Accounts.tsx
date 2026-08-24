import { useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  AlertTriangle,
  AtSign,
  BarChart3,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileEdit,
  FilePlus,
  FileX,
  Info,
  KeyRound,
  Layers,
  Mail,
  MessageSquare,
  Minus,
  PauseCircle,
  Pencil,
  Phone,
  Plus,
  Search,
  ShieldAlert,
  StickyNote,
  Trash2,
  TrendingDown,
  TrendingUp,
  UserRound,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react"
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { NotesButton, NotesThread } from "@/components/NotesThread"
import { OwnerOptions, type OwnerGroup } from "@/components/OwnerOptions"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { daysSince, fullDate, relDays, relTime, toDate } from "@/lib/time"
import { cn } from "@/lib/utils"

// ---------- types (CONTRACT.md → Account tracking) ----------

type Status = "active" | "restricted" | "suspended" | "closed"

type Tracked = {
  status: Status
  followers: number | null
  posts_count: number | null
  last_checked_at: string | null
}

type Account = Tracked & {
  id: number
  user_id: number
  type_id: number
  site_id: number | null
  name: string
  mobile: string | null
  email: string | null
  password: string | null
  link: string | null
  profile_address: string | null
  profile_work: string | null
  notes: string | null
  type_name: string
  allows_pages: number
  site_name: string | null
  owner_name: string
  page_count: number
  prev_followers: number | null
  note_count?: number
}

type Page = Tracked & {
  id: number
  name: string
  url: string | null
  address: string | null
  work: string | null
  note: string | null
  note_count?: number
}

type AccountEvent = {
  id: number
  kind: string
  page_id: number | null
  summary: string
  data: unknown
  actor_name: string | null
  page_name: string | null
  created_at: string
}

type AccountType = { id: number; name: string; allows_pages: number }
type Site = { id: number; name: string }
type UserRow = { id: number; name: string; group_id: number | null }

// ---------- constants & helpers ----------

// ponytail: 14 days = "stale" everywhere (this page + server /stats accounts_attention); change both together
const STALE_DAYS = 14

const STATUS: Record<Status, { label: string; variant: "success" | "warning" | "danger" | "secondary"; icon: LucideIcon }> = {
  active: { label: "نشط", variant: "success", icon: CheckCircle2 },
  restricted: { label: "مقيّد", variant: "warning", icon: ShieldAlert },
  suspended: { label: "موقوف", variant: "danger", icon: PauseCircle },
  closed: { label: "مغلق", variant: "secondary", icon: XCircle },
}
const STATUS_KEYS = Object.keys(STATUS) as Status[]

const KIND: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  created: { label: "إنشاء", icon: Plus, tone: "bg-success-light text-success" },
  updated: { label: "تعديل", icon: Pencil, tone: "bg-primary-light text-primary" },
  status: { label: "تغيير الحالة", icon: ShieldAlert, tone: "bg-warning-light text-warning" },
  metrics: { label: "تحديث الإحصائيات", icon: BarChart3, tone: "bg-info-light text-info" },
  note: { label: "ملاحظة", icon: StickyNote, tone: "bg-warning-light text-warning" },
  page_created: { label: "إضافة صفحة", icon: FilePlus, tone: "bg-success-light text-success" },
  page_updated: { label: "تعديل صفحة", icon: FileEdit, tone: "bg-primary-light text-primary" },
  page_deleted: { label: "حذف صفحة", icon: FileX, tone: "bg-danger-light text-destructive" },
  checked: { label: "فحص", icon: CheckCircle2, tone: "bg-success-light text-success" },
}

const isLate = (at: string | null) => !at || daysSince(at) > STALE_DAYS
const needsAttention = (t: Tracked) => t.status !== "active" || isLate(t.last_checked_at)

const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"))
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n))
const initials = (s: string) => s.trim().slice(0, 2).toUpperCase()
const notify = () => window.dispatchEvent(new Event("ymc:refresh"))
const copy = (v: string) =>
  navigator.clipboard.writeText(v).then(
    () => toast.success("تم النسخ"),
    () => toast.error("تعذر النسخ"),
  )
// event.data may arrive as a JSON string or object; metrics values may be plain numbers or {from,to}
const parseData = (d: unknown): Record<string, unknown> => {
  try {
    const o = typeof d === "string" ? JSON.parse(d) : d
    return o && typeof o === "object" ? (o as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
const num = (v: unknown): number | null =>
  typeof v === "number"
    ? v
    : v && typeof v === "object" && typeof (v as { to?: unknown }).to === "number"
      ? (v as { to: number }).to
      : null

const emptyForm = {
  user_id: "",
  type_id: "",
  site_id: "none",
  name: "",
  mobile: "",
  email: "",
  password: "",
  link: "",
  profile_address: "",
  profile_work: "",
  notes: "",
  status: "active" as Status,
  followers: "",
  posts_count: "",
}
const emptyPageForm = {
  name: "",
  url: "",
  address: "",
  work: "",
  note: "",
  status: "active" as Status,
  followers: "",
  posts_count: "",
}
const emptyQuick = { followers: "", posts_count: "", status: "active" as Status, note: "" }
const toNum = (s: string) => (s.trim() === "" ? null : Number(s))

// ---------- small presentational pieces ----------

function StatusBadge({ status }: { status: Status }) {
  const s = STATUS[status] ?? STATUS.active
  return (
    <Badge variant={s.variant}>
      <s.icon />
      {s.label}
    </Badge>
  )
}

function Delta({ cur, prev }: { cur: number | null; prev: number | null }) {
  if (cur == null || prev == null)
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground" title="لا توجد قراءة سابقة">
        <Minus className="size-3" />—
      </span>
    )
  const d = cur - prev
  const Icon = d > 0 ? TrendingUp : d < 0 ? TrendingDown : Minus
  const cls = d > 0 ? "text-success" : d < 0 ? "text-destructive" : "text-muted-foreground"
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular-nums", cls)} title="التغير منذ آخر تحديث" dir="ltr">
      <Icon className="size-3.5" />
      {signed(d)}
    </span>
  )
}

function LastCheck({ at }: { at: string | null }) {
  if (!at)
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
        <AlertTriangle className="size-3.5" />
        لم يُفحص
      </span>
    )
  const late = isLate(at)
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs", late ? "font-medium text-destructive" : "text-muted-foreground")}
      title={fullDate(at)}
    >
      {late ? <AlertTriangle className="size-3.5" /> : <Clock className="size-3.5" />}
      {relDays(at)}
      {late && " · متأخر"}
    </span>
  )
}

function CopyBtn({ value, label }: { value: string; label: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      className="text-muted-foreground hover:text-foreground"
      aria-label={`نسخ ${label}`}
      title={`نسخ ${label}`}
      onClick={() => copy(value)}
    >
      <Copy />
    </Button>
  )
}

function Tile({ name, className }: { name: string; className?: string }) {
  return (
    <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-light text-sm font-semibold text-primary", className)}>
      {initials(name)}
    </div>
  )
}

function Sparkline({ values }: { values: number[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(120, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = 160
  const PX = 10
  const PY = 22
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = values.length > 1 ? (w - 2 * PX) / (values.length - 1) : 0
  const pts = values.map((v, i) => [PX + i * step, PY + ((max - v) / span) * (H - 2 * PY)] as const)
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
  const first = values[0]
  const last = values[values.length - 1]
  return (
    <div ref={ref} className="w-full">
      <svg
        width={w}
        height={H}
        viewBox={`0 0 ${w} ${H}`}
        role="img"
        aria-label={`المتابعون عبر ${values.length} تحديثات: من ${fmt(first)} إلى ${fmt(last)}، الأدنى ${fmt(min)} والأعلى ${fmt(max)}`}
        className="overflow-visible text-primary"
        style={{ direction: "ltr" }}
      >
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.25" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={PX} x2={w - PX} y1={H - PY} y2={H - PY} className="stroke-border" strokeWidth="1" />
        <polygon points={`${PX},${H - PY} ${line} ${pts[pts.length - 1][0].toFixed(1)},${H - PY}`} fill="url(#spark-fill)" />
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3.5" fill="var(--card)" stroke="currentColor" strokeWidth="2">
            <title>{fmt(values[i])}</title>
          </circle>
        ))}
        <text x={PX} y={12} className="fill-muted-foreground text-[11px] tabular-nums">
          {fmt(max)}
        </text>
        <text x={PX} y={H - 4} className="fill-muted-foreground text-[11px] tabular-nums">
          {fmt(min)}
        </text>
      </svg>
    </div>
  )
}

function Field({
  icon: Icon,
  label,
  value,
  ltr,
  copyable,
  children,
}: {
  icon: LucideIcon
  label: string
  value: string | null
  ltr?: boolean
  copyable?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-dashed px-3 py-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("truncate text-sm font-medium", !value && "text-muted-foreground")} dir={ltr && value ? "ltr" : undefined}>
          {value ?? "—"}
        </p>
      </div>
      {children}
      {copyable && value && <CopyBtn value={value} label={label} />}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-dashed p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-bold tabular-nums", tone)} dir="ltr">
        {value}
      </p>
    </div>
  )
}

const th = "text-xs font-semibold tracking-wide text-muted-foreground uppercase"

// ---------- page ----------

export default function Accounts() {
  const me = useAuth().user!
  const isAdmin = me.role !== "user"

  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<UserRow[]>([])
  const [groups, setGroups] = useState<OwnerGroup[]>([])
  const [filterUser, setFilterUser] = useState("all")
  const [q, setQ] = useState("")
  const [filterType, setFilterType] = useState("all")
  const [filterStatus, setFilterStatus] = useState("all")
  const [chip, setChip] = useState("all")
  const [types, setTypes] = useState<AccountType[]>([])
  const [sites, setSites] = useState<Site[]>([])

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [showPw, setShowPw] = useState(false)
  const [simNumbers, setSimNumbers] = useState<string[]>([])

  const [profileId, setProfileId] = useState<number | null>(null)
  const [tab, setTab] = useState("details")
  const [pages, setPages] = useState<Page[] | null>(null)
  const [events, setEvents] = useState<AccountEvent[] | null>(null)
  const [showProfilePw, setShowProfilePw] = useState(false)

  const [pageOpen, setPageOpen] = useState(false)
  const [editingPage, setEditingPage] = useState<Page | null>(null)
  const [pageForm, setPageForm] = useState(emptyPageForm)
  const [pageNotes, setPageNotes] = useState<Page | null>(null)

  const [quick, setQuick] = useState<{ kind: "account" | "page"; id: number; name: string; cur: Tracked } | null>(null)
  const [quickForm, setQuickForm] = useState(emptyQuick)
  const [saving, setSaving] = useState(false)

  const profile = accounts.find((a) => a.id === profileId) ?? null

  const load = () => {
    const qs = filterUser !== "all" ? `?user_id=${filterUser}` : ""
    api
      .get(`/accounts${qs}`)
      .then(setAccounts)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [filterUser])

  useEffect(() => {
    if (isAdmin) api.get("/users").then(setUsers).catch((e) => toast.error(e.message))
    if (me.role === "super") api.get("/groups").then(setGroups).catch((e) => toast.error(e.message))
  }, [isAdmin, me.role])

  const ownerOptions = <OwnerOptions users={users} groups={groups} meId={me.id} />

  // owner's SIM lines → <datalist> for the mobile input (CONTRACT.md → SIM lines)
  useEffect(() => {
    if (!open) return
    const qs = isAdmin && form.user_id ? `?user_id=${form.user_id}` : ""
    api
      .get(`/sims${qs}`)
      .then((rows: { number: string }[]) => setSimNumbers(rows.map((r) => r.number)))
      .catch(() => setSimNumbers([]))
  }, [open, form.user_id])

  // super: types/sites belong to the selected owner's group
  const ownerGroupId =
    me.role === "super" ? (users.find((u) => u.id === Number(form.user_id))?.group_id ?? null) : null

  useEffect(() => {
    if (me.role === "super" && !ownerGroupId) {
      setTypes([])
      setSites([])
      return
    }
    const qs = ownerGroupId ? `?group_id=${ownerGroupId}` : ""
    Promise.all([api.get(`/types${qs}`), api.get(`/sites${qs}`)])
      .then(([t, s]) => {
        setTypes(t)
        setSites(s)
      })
      .catch((e) => toast.error(e.message))
  }, [me.role, ownerGroupId])

  const loadProfileData = (a: Account) => {
    api.get(`/accounts/${a.id}/events`).then(setEvents).catch((e) => toast.error(e.message))
    if (a.allows_pages) api.get(`/accounts/${a.id}/pages`).then(setPages).catch((e) => toast.error(e.message))
    else setPages([])
  }
  const openProfile = (a: Account, t = "details") => {
    setProfileId(a.id)
    setTab(t)
    setPages(null)
    setEvents(null)
    setShowProfilePw(false)
    loadProfileData(a)
  }
  // after any mutation: list + open profile + sidebar/dashboard counters
  const refreshAll = () => {
    load()
    if (profile) loadProfileData(profile)
    notify()
  }

  // ----- filters -----
  const typeNames = useMemo(() => [...new Set(accounts.map((a) => a.type_name))].sort(), [accounts])
  const base = useMemo(() => {
    const s = q.trim().toLowerCase()
    return accounts.filter(
      (a) =>
        (!s || [a.name, a.email, a.mobile].some((v) => v?.toLowerCase().includes(s))) &&
        (filterType === "all" || a.type_name === filterType) &&
        (filterStatus === "all" || a.status === filterStatus),
    )
  }, [accounts, q, filterType, filterStatus])
  const CHIPS: { key: string; label: string; icon?: LucideIcon; test: (a: Account) => boolean }[] = [
    { key: "all", label: "الكل", test: () => true },
    { key: "active", label: "نشطة", icon: CheckCircle2, test: (a) => a.status === "active" },
    { key: "attention", label: "تحتاج متابعة", icon: AlertTriangle, test: needsAttention },
    { key: "inactive", label: "غير نشطة", icon: PauseCircle, test: (a) => a.status !== "active" },
  ]
  const rows = base.filter(CHIPS.find((c) => c.key === chip)!.test)
  const filtered = rows.length !== accounts.length

  // ----- account create / edit -----
  const openCreate = () => {
    setEditing(null)
    setForm({ ...emptyForm, user_id: String(me.id) })
    setShowPw(false)
    setOpen(true)
  }
  const openEdit = (a: Account) => {
    setEditing(a)
    setForm({
      user_id: String(a.user_id),
      type_id: String(a.type_id),
      site_id: a.site_id ? String(a.site_id) : "none",
      name: a.name,
      mobile: a.mobile ?? "",
      email: a.email ?? "",
      password: a.password ?? "",
      link: a.link ?? "",
      profile_address: a.profile_address ?? "",
      profile_work: a.profile_work ?? "",
      notes: a.notes ?? "",
      status: a.status ?? "active",
      followers: a.followers == null ? "" : String(a.followers),
      posts_count: a.posts_count == null ? "" : String(a.posts_count),
    })
    setShowPw(false)
    setOpen(true)
  }
  const setOwner = (v: string) =>
    setForm((f) => (me.role === "super" ? { ...f, user_id: v, type_id: "", site_id: "none" } : { ...f, user_id: v }))

  const save = async () => {
    if (!form.type_id) return toast.error("النوع مطلوب")
    if (!form.name.trim()) return toast.error("الاسم مطلوب")
    if (!form.mobile.trim() && !form.email.trim())
      return toast.error("يرجى إدخال رقم الجوال أو البريد الإلكتروني على الأقل")
    const body: Record<string, unknown> = {
      type_id: Number(form.type_id),
      site_id: form.site_id !== "none" ? Number(form.site_id) : null,
      name: form.name.trim(),
      mobile: form.mobile.trim() || null,
      email: form.email.trim() || null,
      password: form.password || null,
      link: form.link.trim() || null,
      profile_address: form.profile_address.trim() || null,
      profile_work: form.profile_work.trim() || null,
      notes: form.notes.trim() || null,
      status: form.status,
      followers: toNum(form.followers),
      posts_count: toNum(form.posts_count),
    }
    if (isAdmin) body.user_id = Number(form.user_id)
    setSaving(true)
    try {
      if (editing) {
        await api.put(`/accounts/${editing.id}`, body)
        toast.success("تم تحديث الحساب")
      } else {
        await api.post("/accounts", body)
        toast.success("تم إنشاء الحساب")
      }
      setOpen(false)
      refreshAll()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (a: Account) => {
    try {
      await api.del(`/accounts/${a.id}`)
      toast.success("تم حذف الحساب")
      if (profileId === a.id) setProfileId(null)
      load()
      notify()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // ----- pages -----
  const openPageForm = (p: Page | null) => {
    setEditingPage(p)
    setPageForm(
      p
        ? {
            name: p.name,
            url: p.url ?? "",
            address: p.address ?? "",
            work: p.work ?? "",
            note: p.note ?? "",
            status: p.status ?? "active",
            followers: p.followers == null ? "" : String(p.followers),
            posts_count: p.posts_count == null ? "" : String(p.posts_count),
          }
        : emptyPageForm,
    )
    setPageOpen(true)
  }
  const savePage = async () => {
    if (!pageForm.name.trim()) return toast.error("اسم الصفحة مطلوب")
    const body = {
      name: pageForm.name.trim(),
      url: pageForm.url.trim() || null,
      address: pageForm.address.trim() || null,
      work: pageForm.work.trim() || null,
      note: pageForm.note.trim() || null,
      status: pageForm.status,
      followers: toNum(pageForm.followers),
      posts_count: toNum(pageForm.posts_count),
    }
    setSaving(true)
    try {
      if (editingPage) {
        await api.put(`/pages/${editingPage.id}`, body)
        toast.success("تم تحديث الصفحة")
      } else {
        await api.post(`/accounts/${profile!.id}/pages`, body)
        toast.success("تمت إضافة الصفحة")
      }
      setPageOpen(false)
      refreshAll()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const removePage = async (p: Page) => {
    try {
      await api.del(`/pages/${p.id}`)
      toast.success("تم حذف الصفحة")
      refreshAll()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // ----- quick update (account or page) -----
  const openQuick = (kind: "account" | "page", row: { id: number; name: string } & Tracked) => {
    setQuick({ kind, id: row.id, name: row.name, cur: row })
    setQuickForm({ ...emptyQuick, status: row.status ?? "active" })
  }
  const saveQuick = async () => {
    if (!quick) return
    const body: Record<string, unknown> = {}
    if (quickForm.followers.trim() !== "") body.followers = Number(quickForm.followers)
    if (quickForm.posts_count.trim() !== "") body.posts_count = Number(quickForm.posts_count)
    if (quickForm.status !== quick.cur.status) body.status = quickForm.status
    if (quickForm.note.trim()) body.note = quickForm.note.trim()
    setSaving(true)
    try {
      await api.post(quick.kind === "account" ? `/accounts/${quick.id}/updates` : `/pages/${quick.id}/updates`, body)
      toast.success(quick.kind === "account" ? "تم تحديث الحساب" : "تم تحديث الصفحة")
      setQuick(null)
      refreshAll()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: e.target.value }),
  })
  const pageField = (key: keyof typeof pageForm) => ({
    value: pageForm[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setPageForm({ ...pageForm, [key]: e.target.value }),
  })

  // ----- derived for the stats tab (page metrics are logged on the parent account too → page_id == null only) -----
  const metrics = useMemo(() => (events ?? []).filter((e) => e.kind === "metrics" && e.page_id == null).map((e) => parseData(e.data)).reverse(), [events])
  const followersSeries = metrics.map((m) => num(m.followers)).filter((v): v is number => v != null)
  const postsSeries = metrics.map((m) => num(m.posts_count)).filter((v): v is number => v != null)
  const growth =
    followersSeries.length >= 2 && followersSeries[0] > 0
      ? Math.round(((followersSeries[followersSeries.length - 1] - followersSeries[0]) / followersSeries[0]) * 100)
      : null
  const lastChange =
    followersSeries.length >= 2 ? followersSeries[followersSeries.length - 1] - followersSeries[followersSeries.length - 2] : null
  const newPosts = postsSeries.length >= 2 ? postsSeries[postsSeries.length - 1] - postsSeries[postsSeries.length - 2] : null

  // ----- shared renders -----
  const statusSelect = (value: Status, onChange: (v: Status) => void) => (
    <Select value={value} onValueChange={(v) => onChange(v as Status)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUS_KEYS.map((k) => (
          <SelectItem key={k} value={k}>
            {STATUS[k].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  const deleteAccount = (a: Account) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-lg" className="hover:text-destructive" aria-label="حذف" title="حذف">
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>حذف الحساب؟</AlertDialogTitle>
          <AlertDialogDescription>سيتم حذف «{a.name}» وجميع صفحاته وسجل نشاطه نهائيًا.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction onClick={() => remove(a)}>حذف</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  const actions = (a: Account) => (
    <div className="flex flex-wrap justify-end gap-1">
      <Button variant="ghost" size="icon-lg" className="text-primary" aria-label="تحديث سريع" title="تحديث سريع" onClick={() => openQuick("account", a)}>
        <Zap />
      </Button>
      {a.link && (
        <Button asChild variant="ghost" size="icon-lg" aria-label="فتح الرابط" title="فتح الرابط">
          <a href={a.link} target="_blank" rel="noreferrer">
            <ExternalLink />
          </a>
        </Button>
      )}
      <NotesButton count={a.note_count} label="الملاحظات الخاصة" onClick={() => openProfile(a, "notes")} />
      <Button variant="ghost" size="icon-lg" aria-label="ملف الحساب" title="ملف الحساب" onClick={() => openProfile(a)}>
        <Eye />
      </Button>
      <Button variant="ghost" size="icon-lg" aria-label="تعديل" title="تعديل" onClick={() => openEdit(a)}>
        <Pencil />
      </Button>
      {deleteAccount(a)}
    </div>
  )

  const contact = (a: Account) =>
    !a.email && !a.mobile ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <div className="space-y-0.5">
        {a.email && (
          <div className="flex items-center gap-1">
            <Mail className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm" dir="ltr">
              {a.email}
            </span>
            <CopyBtn value={a.email} label="البريد" />
          </div>
        )}
        {a.mobile && (
          <div className="flex items-center gap-1">
            <Phone className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm tabular-nums" dir="ltr">
              {a.mobile}
            </span>
            <CopyBtn value={a.mobile} label="الجوال" />
          </div>
        )}
      </div>
    )

  const followersCell = (t: { followers: number | null; prev_followers?: number | null }) => (
    <div className="flex flex-col">
      <span className="font-semibold tabular-nums">{fmt(t.followers)}</span>
      <Delta cur={t.followers} prev={t.prev_followers ?? null} />
    </div>
  )

  return (
    <div className="space-y-4">
      <Card className="gap-0 py-0">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3 border-b py-4 [.border-b]:pb-4">
          <div>
            <CardTitle className="text-[1.05rem] font-bold">الحسابات</CardTitle>
            <CardDescription className="mt-1 text-xs">
              {loading ? "…" : filtered ? `${rows.length} من ${accounts.length} حساب` : `${accounts.length} حساب`}
            </CardDescription>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto">
            <div className="relative w-full sm:w-60">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="ps-8"
                placeholder="بحث بالاسم أو البريد أو الجوال"
                aria-label="بحث"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-full sm:w-36" aria-label="النوع">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأنواع</SelectItem>
                {typeNames.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-full sm:w-32" aria-label="الحالة">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                {STATUS_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {STATUS[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isAdmin && (
              <Select value={filterUser} onValueChange={setFilterUser}>
                <SelectTrigger className="w-full sm:w-44" aria-label="المالك">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع المستخدمين</SelectItem>
                  {ownerOptions}
                </SelectContent>
              </Select>
            )}
            <Button className="w-full sm:w-auto" onClick={openCreate}>
              <Plus />
              حساب جديد
            </Button>
          </div>
        </CardHeader>

        {/* quick-filter chips */}
        <div className="flex flex-wrap gap-2 border-b border-dashed px-4 py-3 md:px-6" role="group" aria-label="تصفية سريعة">
          {CHIPS.map((c) => {
            const active = chip === c.key
            const count = base.filter(c.test).length
            const alert = c.key === "attention" && count > 0
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={active}
                onClick={() => setChip(c.key)}
                className={cn(
                  "inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-btn border px-3 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {c.icon && <c.icon className="size-4" />}
                {c.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-xs tabular-nums",
                    active ? "bg-white/20" : alert ? "bg-danger-light text-destructive" : "bg-muted",
                  )}
                >
                  {loading ? "…" : count}
                </span>
              </button>
            )
          })}
        </div>

        <CardContent className="p-4 md:p-6">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="hidden h-4 w-16 md:block" />
                  <Skeleton className="hidden h-4 w-20 md:block" />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className={cn("flex size-12 items-center justify-center rounded-lg", accounts.length ? "bg-success-light text-success" : "bg-primary-light text-primary")}>
                {accounts.length ? <CheckCircle2 className="size-6" /> : <AtSign className="size-6" />}
              </div>
              <div>
                <p className="font-medium">{accounts.length ? "لا توجد نتائج مطابقة" : "لا توجد حسابات بعد"}</p>
                <p className="text-sm text-muted-foreground">
                  {accounts.length
                    ? chip === "attention"
                      ? "كل الحسابات محدّثة ونشطة — أحسنت."
                      : "جرّب تغيير البحث أو عوامل التصفية."
                    : filterUser !== "all"
                      ? "لا توجد حسابات لهذا المستخدم."
                      : "أضف أول حساب تواصل اجتماعي للبدء."}
                </p>
              </div>
              {accounts.length ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setQ("")
                    setFilterType("all")
                    setFilterStatus("all")
                    setChip("all")
                  }}
                >
                  مسح التصفية
                </Button>
              ) : (
                <Button onClick={openCreate}>
                  <Plus />
                  حساب جديد
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* md+: table */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="border-dashed">
                      <TableHead className={th}>الحساب</TableHead>
                      {isAdmin && <TableHead className={th}>المالك</TableHead>}
                      <TableHead className={th}>التواصل</TableHead>
                      <TableHead className={th}>المتابعون</TableHead>
                      <TableHead className={th}>المنشورات</TableHead>
                      <TableHead className={th}>آخر فحص</TableHead>
                      <TableHead className={th}>الصفحات</TableHead>
                      <TableHead className="w-64" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((a) => (
                      <TableRow key={a.id} className="border-dashed transition-colors duration-150">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Tile name={a.name} />
                            <div className="min-w-0">
                              <p className="truncate font-semibold">
                                {a.name}
                                {a.site_name && <span className="ms-1 text-xs font-normal text-muted-foreground">· {a.site_name}</span>}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                <Badge variant="primary-light">{a.type_name}</Badge>
                                <StatusBadge status={a.status} />
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        {isAdmin && <TableCell className="whitespace-nowrap">{a.owner_name}</TableCell>}
                        <TableCell className="max-w-56">{contact(a)}</TableCell>
                        <TableCell>{followersCell(a)}</TableCell>
                        <TableCell className="tabular-nums">{fmt(a.posts_count)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <LastCheck at={a.last_checked_at} />
                        </TableCell>
                        <TableCell>
                          {a.allows_pages ? (
                            <button
                              type="button"
                              className="cursor-pointer rounded-badge focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none"
                              onClick={() => openProfile(a, "pages")}
                              aria-label={`${a.page_count} صفحات — فتح`}
                            >
                              <Badge variant="info" className="tabular-nums">
                                <Layers />
                                {a.page_count}
                              </Badge>
                            </button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>{actions(a)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* <md: stacked cards */}
              <div className="space-y-3 md:hidden">
                {rows.map((a) => (
                  <div key={a.id} className={cn("space-y-3 rounded-lg border p-4", needsAttention(a) && "border-s-4 border-s-destructive")}>
                    <div className="flex items-center gap-3">
                      <Tile name={a.name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{a.name}</p>
                        {isAdmin && (
                          <p className="inline-flex items-center gap-1 truncate text-xs text-muted-foreground">
                            <UserRound className="size-3" />
                            {a.owner_name}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="primary-light">{a.type_name}</Badge>
                      <StatusBadge status={a.status} />
                      {a.site_name && <Badge variant="secondary">{a.site_name}</Badge>}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-md bg-muted/50 p-2">
                        <p className="text-xs text-muted-foreground">المتابعون</p>
                        {followersCell(a)}
                      </div>
                      <div className="rounded-md bg-muted/50 p-2">
                        <p className="text-xs text-muted-foreground">المنشورات</p>
                        <p className="font-semibold tabular-nums">{fmt(a.posts_count)}</p>
                      </div>
                      <div className="rounded-md bg-muted/50 p-2">
                        <p className="text-xs text-muted-foreground">آخر فحص</p>
                        <LastCheck at={a.last_checked_at} />
                      </div>
                      <div className="rounded-md bg-muted/50 p-2">
                        <p className="text-xs text-muted-foreground">الصفحات</p>
                        <p className="font-semibold tabular-nums">{a.allows_pages ? a.page_count : "—"}</p>
                      </div>
                    </div>
                    {contact(a)}
                    <div className="border-t border-dashed pt-2">{actions(a)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------- create / edit account ---------- */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل الحساب" : "حساب جديد"}</DialogTitle>
            <DialogDescription>يرجى إدخال رقم الجوال أو البريد الإلكتروني على الأقل.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {isAdmin && (
              <div className="grid gap-1.5">
                <Label>المالك</Label>
                <Select value={form.user_id} onValueChange={setOwner}>
                  <SelectTrigger className="w-full" aria-label="مالك الحساب">
                    <SelectValue placeholder="اختر المالك" />
                  </SelectTrigger>
                  <SelectContent>{ownerOptions}</SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>النوع</Label>
                <Select value={form.type_id} onValueChange={(v) => setForm({ ...form, type_id: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="اختر النوع" />
                  </SelectTrigger>
                  <SelectContent>
                    {types.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>الموقع</Label>
                <Select value={form.site_id} onValueChange={(v) => setForm({ ...form, site_id: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون</SelectItem>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>الاسم</Label>
              <Input {...field("name")} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>رقم الجوال</Label>
                <Input inputMode="tel" list="sim-numbers" {...field("mobile")} />
                <datalist id="sim-numbers">
                  {simNumbers.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>
              <div className="grid gap-1.5">
                <Label>البريد الإلكتروني</Label>
                <Input type="email" {...field("email")} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>كلمة المرور</Label>
              <div className="relative">
                <Input type={showPw ? "text" : "password"} className="pe-9" {...field("password")} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute top-0 end-0 size-9"
                  onClick={() => setShowPw(!showPw)}
                  aria-label={showPw ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                >
                  {showPw ? <EyeOff /> : <Eye />}
                </Button>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>الرابط</Label>
              <Input inputMode="url" {...field("link")} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>عنوان الملف الشخصي</Label>
                <Input {...field("profile_address")} />
              </div>
              <div className="grid gap-1.5">
                <Label>عمل الملف الشخصي</Label>
                <Input {...field("profile_work")} />
              </div>
            </div>
            <fieldset className="grid gap-3 rounded-lg border border-dashed p-3">
              <legend className="px-1 text-xs font-semibold text-muted-foreground">التتبع</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label>الحالة</Label>
                  {statusSelect(form.status, (v) => setForm({ ...form, status: v }))}
                </div>
                <div className="grid gap-1.5">
                  <Label>المتابعون</Label>
                  <Input type="number" min={0} inputMode="numeric" {...field("followers")} />
                </div>
                <div className="grid gap-1.5">
                  <Label>المنشورات</Label>
                  <Input type="number" min={0} inputMode="numeric" {...field("posts_count")} />
                </div>
              </div>
            </fieldset>
            <div className="grid gap-1.5">
              <Label>ملاحظات</Label>
              <Textarea rows={2} {...field("notes")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={save} disabled={saving}>
              {editing ? "حفظ" : "إنشاء"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- account profile ---------- */}
      <Dialog open={!!profile} onOpenChange={(o) => !o && setProfileId(null)}>
        <DialogContent className="sm:max-w-3xl max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:rounded-none">
          {profile && (
            <>
              <DialogHeader className="pe-8 text-start">
                <div className="flex items-start gap-3">
                  <Tile name={profile.name} className="size-12 text-base" />
                  <div className="min-w-0 flex-1">
                    <DialogTitle className="truncate">{profile.name}</DialogTitle>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge variant="primary-light">{profile.type_name}</Badge>
                      {profile.site_name && <Badge variant="secondary">{profile.site_name}</Badge>}
                      <StatusBadge status={profile.status} />
                    </div>
                    <DialogDescription className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {isAdmin && (
                        <span className="inline-flex items-center gap-1">
                          <UserRound className="size-3.5" />
                          {profile.owner_name}
                        </span>
                      )}
                      <LastCheck at={profile.last_checked_at} />
                    </DialogDescription>
                  </div>
                  {profile.link && (
                    <Button asChild variant="light" size="sm" className="hidden sm:inline-flex">
                      <a href={profile.link} target="_blank" rel="noreferrer">
                        <ExternalLink />
                        فتح الرابط
                      </a>
                    </Button>
                  )}
                </div>
              </DialogHeader>

              <Tabs value={tab} onValueChange={setTab} className="min-w-0">
                <TabsList className="flex w-full justify-start overflow-x-auto sm:grid sm:grid-cols-5 [&>button]:max-sm:shrink-0 [&>button]:max-sm:px-3">
                  <TabsTrigger value="details">
                    <Info className="hidden sm:block" />
                    التفاصيل
                  </TabsTrigger>
                  <TabsTrigger value="pages">
                    <Layers className="hidden sm:block" />
                    الصفحات
                  </TabsTrigger>
                  <TabsTrigger value="activity">
                    <Activity className="hidden sm:block" />
                    النشاط
                  </TabsTrigger>
                  <TabsTrigger value="stats">
                    <BarChart3 className="hidden sm:block" />
                    الإحصائيات
                  </TabsTrigger>
                  <TabsTrigger value="notes">
                    <MessageSquare className="hidden sm:block" />
                    الملاحظات الخاصة
                    {(profile.note_count ?? 0) > 0 && (
                      <Badge variant="primary-light" className="px-1.5 py-0 tabular-nums">
                        {profile.note_count}
                      </Badge>
                    )}
                  </TabsTrigger>
                </TabsList>

                {/* التفاصيل */}
                <TabsContent value="details" className="space-y-3 pt-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field icon={Mail} label="البريد الإلكتروني" value={profile.email} ltr copyable />
                    <Field icon={Phone} label="رقم الجوال" value={profile.mobile} ltr copyable />
                    <Field
                      icon={KeyRound}
                      label="كلمة المرور"
                      value={profile.password ? (showProfilePw ? profile.password : "••••••••") : null}
                      ltr
                    >
                      {profile.password && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-lg"
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={showProfilePw ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                            title={showProfilePw ? "إخفاء" : "إظهار"}
                            onClick={() => setShowProfilePw((s) => !s)}
                          >
                            {showProfilePw ? <EyeOff /> : <Eye />}
                          </Button>
                          <CopyBtn value={profile.password} label="كلمة المرور" />
                        </>
                      )}
                    </Field>
                    <Field icon={ExternalLink} label="الرابط" value={profile.link} ltr copyable>
                      {profile.link && (
                        <Button asChild variant="ghost" size="icon-lg" className="text-muted-foreground hover:text-foreground" aria-label="فتح الرابط" title="فتح الرابط">
                          <a href={profile.link} target="_blank" rel="noreferrer">
                            <ExternalLink />
                          </a>
                        </Button>
                      )}
                    </Field>
                    <Field icon={Info} label="عنوان الملف الشخصي" value={profile.profile_address} />
                    <Field icon={Info} label="عمل الملف الشخصي" value={profile.profile_work} />
                  </div>
                  <div className="rounded-md border border-dashed px-3 py-2">
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <StickyNote className="size-3.5" />
                      ملاحظات
                    </p>
                    <p className={cn("mt-1 text-sm whitespace-pre-wrap", !profile.notes && "text-muted-foreground")}>{profile.notes ?? "—"}</p>
                  </div>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button variant="outline" onClick={() => openEdit(profile)}>
                      <Pencil />
                      تعديل
                    </Button>
                    <Button onClick={() => openQuick("account", profile)}>
                      <Zap />
                      تحديث سريع
                    </Button>
                  </div>
                </TabsContent>

                {/* الصفحات */}
                <TabsContent value="pages" className="space-y-3 pt-2">
                  {!profile.allows_pages ? (
                    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center">
                      <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Layers className="size-5" />
                      </div>
                      <p className="text-sm text-muted-foreground">نوع «{profile.type_name}» لا يدعم الصفحات الفرعية.</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-muted-foreground">{pages ? `${pages.length} صفحة` : "…"}</p>
                        <Button size="sm" onClick={() => openPageForm(null)}>
                          <Plus />
                          صفحة جديدة
                        </Button>
                      </div>
                      {pages === null ? (
                        <div className="space-y-2">
                          {Array.from({ length: 3 }, (_, i) => (
                            <Skeleton key={i} className="h-14 w-full" />
                          ))}
                        </div>
                      ) : pages.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed p-6 text-center">
                          <div className="flex size-10 items-center justify-center rounded-lg bg-info-light text-info">
                            <Layers className="size-5" />
                          </div>
                          <p className="text-sm text-muted-foreground">لا توجد صفحات بعد.</p>
                          <Button variant="outline" size="sm" onClick={() => openPageForm(null)}>
                            <Plus />
                            أضف الصفحة الأولى
                          </Button>
                        </div>
                      ) : (
                        <ul className="space-y-2">
                          {pages.map((p) => (
                            <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm">
                              <div className="min-w-0 flex-1 basis-40">
                                <p className="truncate font-medium">{p.name}</p>
                                {p.url && (
                                  <a
                                    href={p.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block truncate text-xs text-muted-foreground hover:text-primary hover:underline"
                                    dir="ltr"
                                  >
                                    {p.url}
                                  </a>
                                )}
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                                  <StatusBadge status={p.status ?? "active"} />
                                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                    <UserRound className="size-3" />
                                    <span className="tabular-nums">{fmt(p.followers)}</span>
                                  </span>
                                  <LastCheck at={p.last_checked_at} />
                                </div>
                              </div>
                              <div className="flex gap-1">
                                <NotesButton count={p.note_count} label="الملاحظات الخاصة" onClick={() => setPageNotes(p)} />
                                <Button variant="ghost" size="icon-lg" className="text-primary" aria-label="تحديث سريع" title="تحديث سريع" onClick={() => openQuick("page", p)}>
                                  <Zap />
                                </Button>
                                <Button variant="ghost" size="icon-lg" aria-label="تعديل" title="تعديل" onClick={() => openPageForm(p)}>
                                  <Pencil />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon-lg" className="hover:text-destructive" aria-label="حذف" title="حذف">
                                      <Trash2 />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>حذف الصفحة؟</AlertDialogTitle>
                                      <AlertDialogDescription>سيتم حذف «{p.name}» نهائيًا.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>إلغاء</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => removePage(p)}>حذف</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </TabsContent>

                {/* النشاط */}
                <TabsContent value="activity" className="pt-2">
                  {events === null ? (
                    <div className="space-y-3">
                      {Array.from({ length: 4 }, (_, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <Skeleton className="size-9 rounded-full" />
                          <div className="flex-1 space-y-2">
                            <Skeleton className="h-4 w-3/4" />
                            <Skeleton className="h-3 w-1/3" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : events.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center">
                      <div className="flex size-10 items-center justify-center rounded-lg bg-primary-light text-primary">
                        <Activity className="size-5" />
                      </div>
                      <p className="text-sm text-muted-foreground">لا يوجد نشاط بعد.</p>
                    </div>
                  ) : (
                    <ol className="ms-4 border-s border-dashed">
                      {events.map((e) => {
                        const k = KIND[e.kind] ?? { label: e.kind, icon: Activity, tone: "bg-muted text-muted-foreground" }
                        return (
                          <li key={e.id} className="relative ps-7 pb-5 last:pb-0">
                            <span className={cn("absolute top-0 -start-[18px] flex size-9 items-center justify-center rounded-full ring-4 ring-card", k.tone)}>
                              <k.icon className="size-4" />
                            </span>
                            <p className="text-sm leading-snug pt-2">{e.summary}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              <span className="font-medium">{k.label}</span>
                              {e.actor_name && (
                                <span className="inline-flex items-center gap-1">
                                  <UserRound className="size-3" />
                                  {e.actor_name}
                                </span>
                              )}
                              {e.page_name && (
                                <Badge variant="info">
                                  <Layers />
                                  {e.page_name}
                                </Badge>
                              )}
                              <time dateTime={toDate(e.created_at).toISOString()} title={fullDate(e.created_at)}>
                                {relTime(e.created_at)}
                              </time>
                            </div>
                          </li>
                        )
                      })}
                    </ol>
                  )}
                </TabsContent>

                {/* الإحصائيات */}
                <TabsContent value="stats" className="space-y-4 pt-2">
                  {events === null ? (
                    <Skeleton className="h-40 w-full" />
                  ) : followersSeries.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed p-6 text-center">
                      <div className="flex size-10 items-center justify-center rounded-lg bg-info-light text-info">
                        <BarChart3 className="size-5" />
                      </div>
                      <p className="text-sm text-muted-foreground">لا توجد قراءات بعد — سجّل أول تحديث سريع لبدء تتبع المتابعين.</p>
                      <Button size="sm" onClick={() => openQuick("account", profile)}>
                        <Zap />
                        تحديث سريع
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="rounded-lg border border-dashed p-3">
                        <p className="mb-2 text-xs font-semibold text-muted-foreground">المتابعون عبر الزمن · {followersSeries.length} قراءة</p>
                        {followersSeries.length >= 2 ? (
                          <Sparkline values={followersSeries} />
                        ) : (
                          <p className="py-6 text-center text-sm text-muted-foreground">قراءة واحدة فقط ({fmt(followersSeries[0])}) — أضف تحديثًا آخر لرسم المنحنى.</p>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <Stat label="الحالي" value={fmt(profile.followers)} />
                        <Stat
                          label="النمو منذ أول تحديث"
                          value={growth == null ? "—" : `${growth > 0 ? "+" : ""}${growth}%`}
                          tone={growth == null ? undefined : growth > 0 ? "text-success" : growth < 0 ? "text-destructive" : undefined}
                        />
                        <Stat
                          label="آخر تغيير"
                          value={lastChange == null ? "—" : signed(lastChange)}
                          tone={lastChange == null ? undefined : lastChange > 0 ? "text-success" : lastChange < 0 ? "text-destructive" : undefined}
                        />
                      </div>
                      <div className="flex items-center gap-3 rounded-lg border border-dashed p-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary">
                          <FilePlus className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-muted-foreground">منشورات جديدة منذ آخر فحص</p>
                          <p className="text-lg font-bold tabular-nums" dir="ltr">
                            {newPosts == null ? "—" : signed(newPosts)}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground">الإجمالي: {fmt(profile.posts_count)}</span>
                      </div>
                    </>
                  )}
                </TabsContent>

                {/* الملاحظات الخاصة */}
                <TabsContent value="notes" className="pt-2">
                  <NotesThread type="account" id={profile.id} title={profile.name} onChange={refreshAll} />
                </TabsContent>
              </Tabs>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ---------- page private notes ---------- */}
      <Dialog open={!!pageNotes} onOpenChange={(o) => !o && setPageNotes(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="size-5 text-primary" />
              الملاحظات الخاصة — {pageNotes?.name}
            </DialogTitle>
            <DialogDescription>محادثة خاصة حول هذه الصفحة ضمن حساب «{profile?.name}».</DialogDescription>
          </DialogHeader>
          {pageNotes && <NotesThread type="page" id={pageNotes.id} title={pageNotes.name} onChange={refreshAll} />}
        </DialogContent>
      </Dialog>

      {/* ---------- page create / edit ---------- */}
      <Dialog open={pageOpen} onOpenChange={setPageOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingPage ? `تعديل «${editingPage.name}»` : "صفحة جديدة"}</DialogTitle>
            <DialogDescription>صفحة فرعية ضمن حساب «{profile?.name}».</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>الاسم</Label>
                <Input {...pageField("name")} />
              </div>
              <div className="grid gap-1.5">
                <Label>الرابط</Label>
                <Input inputMode="url" {...pageField("url")} />
              </div>
              <div className="grid gap-1.5">
                <Label>العنوان</Label>
                <Input {...pageField("address")} />
              </div>
              <div className="grid gap-1.5">
                <Label>العمل</Label>
                <Input {...pageField("work")} />
              </div>
            </div>
            <fieldset className="grid gap-3 rounded-lg border border-dashed p-3">
              <legend className="px-1 text-xs font-semibold text-muted-foreground">التتبع</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label>الحالة</Label>
                  {statusSelect(pageForm.status, (v) => setPageForm({ ...pageForm, status: v }))}
                </div>
                <div className="grid gap-1.5">
                  <Label>المتابعون</Label>
                  <Input type="number" min={0} inputMode="numeric" {...pageField("followers")} />
                </div>
                <div className="grid gap-1.5">
                  <Label>المنشورات</Label>
                  <Input type="number" min={0} inputMode="numeric" {...pageField("posts_count")} />
                </div>
              </div>
            </fieldset>
            <div className="grid gap-1.5">
              <Label>ملاحظة</Label>
              <Textarea rows={2} {...pageField("note")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPageOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={savePage} disabled={saving}>
              {editingPage ? "حفظ" : "إضافة صفحة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- quick update (account / page) ---------- */}
      <Dialog open={!!quick} onOpenChange={(o) => !o && setQuick(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="size-5 text-primary" />
              تحديث سريع — {quick?.name}
            </DialogTitle>
            <DialogDescription>سجّل آخر الأرقام والحالة. اترك الحقل فارغًا إن لم يتغير؛ الحفظ بلا تغييرات يسجّل عملية فحص فقط.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>المتابعون</Label>
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  placeholder={`الحالي: ${fmt(quick?.cur.followers)}`}
                  value={quickForm.followers}
                  onChange={(e) => setQuickForm({ ...quickForm, followers: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>المنشورات</Label>
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  placeholder={`الحالي: ${fmt(quick?.cur.posts_count)}`}
                  value={quickForm.posts_count}
                  onChange={(e) => setQuickForm({ ...quickForm, posts_count: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>الحالة</Label>
              {statusSelect(quickForm.status, (v) => setQuickForm({ ...quickForm, status: v }))}
            </div>
            <div className="grid gap-1.5">
              <Label>ملاحظة</Label>
              <Textarea rows={2} placeholder="اختياري" value={quickForm.note} onChange={(e) => setQuickForm({ ...quickForm, note: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuick(null)}>
              إلغاء
            </Button>
            <Button onClick={saveQuick} disabled={saving}>
              <CheckCircle2 />
              حفظ التحديث
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
