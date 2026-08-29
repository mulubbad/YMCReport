import { useEffect, useRef, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Inbox,
  KeyRound,
  ListChecks,
  MessageSquare,
  Search,
  Smartphone,
} from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useScope } from "@/lib/scope"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const SHEETS: { key: string; label: string; icon: typeof KeyRound; desc?: string }[] = [
  { key: "accounts", label: "الحسابات", icon: KeyRound },
  { key: "sims", label: "خطوط الاتصال", icon: Smartphone, desc: "أرقام الجوال التي يحملها الأعضاء — جوال / أوريدو" },
  { key: "pages", label: "الصفحات", icon: FileText },
  { key: "tasks", label: "المهام", icon: ListChecks },
  { key: "interactions", label: "التفاعلات", icon: MessageSquare },
  { key: "summary", label: "الملخص", icon: BarChart3 },
  { key: "events", label: "سجل التحديثات", icon: History },
]
const LIMIT = 500
const PAGE_SIZES = [25, 50, 100]

type UserRow = { id: number; name: string }
type AccountType = { id: number; name: string }
type Cell = string | number | boolean | null
type Report = { sheet: string; title: string; columns: string[]; rows: Cell[][]; total: number }

function toggle<T>(set: Set<T>, v: T, on: boolean): Set<T> {
  const next = new Set(set)
  if (on) next.add(v)
  else next.delete(v)
  return next
}

const sheetCount = (n: number) => (n === 1 ? "ورقة واحدة" : n === 2 ? "ورقتان" : `${n} أوراق`)
const text = (c: Cell) => (c == null ? "" : String(c))
const collator = new Intl.Collator("ar", { numeric: true, sensitivity: "base" })
function compare(a: Cell, b: Cell): number {
  const na = Number(a), nb = Number(b)
  if (text(a) !== "" && text(b) !== "" && Number.isFinite(na) && Number.isFinite(nb)) return na - nb
  return collator.compare(text(a), text(b))
}

function CheckList<T extends { id: number; name: string }>({
  prefix,
  items,
  selected,
  onChange,
  empty,
}: {
  prefix: string
  items: T[]
  selected: Set<number>
  onChange: (s: Set<number>) => void
  empty: string
}) {
  return (
    <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-3">
      {items.map((i) => (
        <div key={i.id} className="flex items-center gap-2">
          <Checkbox
            id={`${prefix}-${i.id}`}
            checked={selected.has(i.id)}
            onCheckedChange={(c) => onChange(toggle(selected, i.id, c === true))}
          />
          <Label htmlFor={`${prefix}-${i.id}`} className="font-normal">
            {i.name}
          </Label>
        </div>
      ))}
      {items.length === 0 && <p className="text-xs text-muted-foreground">{empty}</p>}
    </div>
  )
}

// ponytail: client-side table; server-side paging only if sheets outgrow the 500 limit
function DataTable({ data, loading }: { data: Report | null; loading: boolean }) {
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<{ col: number; dir: "asc" | "desc" } | null>(null)
  const [pageSize, setPageSize] = useState(25)
  const [pageRaw, setPage] = useState(0)

  const columns = data?.columns ?? []
  const q = search.trim().toLowerCase()
  const filtered = (data?.rows ?? []).filter((r) => !q || r.some((c) => text(c).toLowerCase().includes(q)))
  const sorted = sort
    ? [...filtered].sort((a, b) => compare(a[sort.col], b[sort.col]) * (sort.dir === "asc" ? 1 : -1))
    : filtered
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const page = Math.min(pageRaw, pages - 1)
  const start = page * pageSize
  const visible = sorted.slice(start, start + pageSize)
  const moreOnServer = data && data.total > data.rows.length

  const toggleSort = (col: number) =>
    setSort((s) => (s?.col === col ? (s.dir === "asc" ? { col, dir: "desc" } : null) : { col, dir: "asc" }))

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="بحث في الورقة"
            placeholder="بحث…"
            className="h-11 ps-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {sorted.length ? `عرض ${start + 1}–${Math.min(start + pageSize, sorted.length)} من ${sorted.length}` : "عرض 0 من 0"}
            {moreOnServer && <span className="text-xs"> (من أصل {data.total})</span>}
          </p>
          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(0) }}>
            <SelectTrigger className="h-11 w-24" aria-label="عدد الصفوف في الصفحة">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>{n} صف</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="max-h-[65vh] overflow-auto rounded-md border">
        <table className="w-full caption-bottom text-sm">
          <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-11 w-10 px-3">#</TableHead>
              {(loading && !columns.length ? Array.from({ length: 6 }, () => "") : columns).map((c, i) => {
                const active = sort?.col === i
                const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown
                return (
                  <TableHead
                    key={i}
                    className="h-11 p-0"
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    {c ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(i)}
                        className={cn(
                          "flex h-11 w-full cursor-pointer items-center gap-1.5 px-3 text-start uppercase transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
                          active && "text-primary"
                        )}
                      >
                        {c}
                        <Icon className={cn("size-3.5 shrink-0", !active && "opacity-50")} aria-hidden />
                      </button>
                    ) : (
                      <Skeleton className="mx-3 h-3 w-20" />
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 8 }, (_, r) => (
                <TableRow key={r}>
                  {Array.from({ length: (columns.length || 6) + 1 }, (_, c) => (
                    <TableCell key={c} className="h-11">
                      <Skeleton className="h-3 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : visible.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={(columns.length || 1) + 1} className="py-12">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <div className="flex size-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Inbox className="size-5" />
                    </div>
                    <p className="text-sm text-muted-foreground">لا توجد بيانات مطابقة</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              visible.map((r, i) => (
                <TableRow key={start + i}>
                  <TableCell className="h-11 px-3 text-xs text-muted-foreground tabular-nums">{start + i + 1}</TableCell>
                  {r.map((c, j) => {
                    const t = text(c)
                    return (
                      <TableCell key={j} className="h-11 max-w-[16rem] truncate px-3 tabular-nums" title={t}>
                        {t}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" className="h-11 min-w-11" onClick={() => setPage(page - 1)} disabled={page === 0}>
            <ChevronRight aria-hidden />
            <span className="hidden sm:inline">السابق</span>
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">صفحة {page + 1} من {pages}</span>
          <Button variant="outline" className="h-11 min-w-11" onClick={() => setPage(page + 1)} disabled={page >= pages - 1}>
            <span className="hidden sm:inline">التالي</span>
            <ChevronLeft aria-hidden />
          </Button>
        </div>
      )}
    </div>
  )
}

export default function Export() {
  const me = useAuth().user!
  const isSuper = me.role === "super"
  const [sheets, setSheets] = useState(new Set(SHEETS.map((s) => s.key)))
  const [active, setActive] = useState(SHEETS[0].key)
  const [users, setUsers] = useState<UserRow[]>([])
  const [types, setTypes] = useState<AccountType[]>([])
  const [userIds, setUserIds] = useState(new Set<number>())
  const [typeIds, setTypeIds] = useState(new Set<number>())
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const reqId = useRef(0)

  const filterParams = () => {
    const p = new URLSearchParams()
    if (userIds.size) p.set("user_ids", [...userIds].join(","))
    if (typeIds.size) p.set("type_ids", [...typeIds].join(","))
    if (from) p.set("from", from)
    if (to) p.set("to", to)
    return p
  }
  const filterKey = filterParams().toString()

  // the report always covers the active workspace (api.ts carries it); the switcher is the group control
  const { gid, active: activeGroup } = useScope()

  useEffect(() => {
    api.get("/users").then(setUsers).catch(() => setUsers([]))
    api.get("/types").then(setTypes).catch(() => setTypes([]))
    setUserIds(new Set())
    setTypeIds(new Set())
  }, [gid])

  useEffect(() => setCounts({}), [filterKey])

  useEffect(() => {
    const id = ++reqId.current
    const p = filterParams()
    p.set("sheet", active)
    p.set("limit", String(LIMIT))
    setLoading(true)
    api
      .get(`/report?${p}`)
      .then((r: Report) => {
        if (id !== reqId.current) return
        setData(r)
        setCounts((c) => ({ ...c, [active]: r.total }))
      })
      .catch((err) => {
        if (id !== reqId.current) return
        setData(null)
        toast.error(err instanceof Error ? err.message : "تعذر تحميل البيانات")
      })
      .finally(() => id === reqId.current && setLoading(false))
  }, [active, filterKey])

  const download = async (only?: string) => {
    const p = filterParams()
    if (only) p.set("sheets", only)
    else if (sheets.size < SHEETS.length) p.set("sheets", [...sheets].join(","))
    setBusy(true)
    try {
      const q = p.toString()
      await api.download(`/export${q ? `?${q}` : ""}`)
      toast.success("تم تنزيل التقرير")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر تصدير التقرير")
    } finally {
      setBusy(false)
    }
  }

  const activeSheet = SHEETS.find((s) => s.key === active)!
  const summary = [
    sheetCount(sheets.size),
    userIds.size ? `${userIds.size} مستخدم` : "كل المستخدمين",
    typeIds.size ? `${typeIds.size} نوع` : "كل الأنواع",
    ...(isSuper ? [activeGroup?.name ?? "جميع المجموعات"] : []),
    ...(from || to ? [`${from || "…"} → ${to || "…"}`] : []),
  ].join(" · ")

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        اختر عوامل التصفية لمعاينة البيانات، ثم نزّل التقرير بصيغة Excel.
      </p>

      <Card className="gap-0 py-0">
        <CardHeader>
          <div>
            <div className="text-[1.05rem] font-bold">عوامل التصفية</div>
            <div className="text-xs text-muted-foreground">اختيارية — اتركها فارغة لتشمل الكل</div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 p-4 md:grid-cols-2 md:p-6 xl:grid-cols-4">
          <div className="space-y-2">
            <Label>المستخدمون</Label>
            <CheckList prefix="user" items={users} selected={userIds} onChange={setUserIds} empty="لا يوجد مستخدمون" />
          </div>
          <div className="space-y-2">
            <Label>أنواع الحسابات</Label>
            <CheckList prefix="type" items={types} selected={typeIds} onChange={setTypeIds} empty="لا توجد أنواع حسابات" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="from">من</Label>
              <Input id="from" type="date" className="h-11" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to">إلى</Label>
              <Input id="to" type="date" className="h-11" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0">
        <CardHeader className="py-2">
          <Tabs value={active} onValueChange={setActive} className="w-full min-w-0">
            <TabsList variant="line" className="h-auto w-full justify-start overflow-x-auto">
              {SHEETS.map((s) => (
                <TabsTrigger key={s.key} value={s.key} title={s.desc} className="h-11 flex-none px-3">
                  <s.icon aria-hidden />
                  {s.label}
                  {counts[s.key] != null && (
                    <Badge variant={s.key === active ? "primary-light" : "secondary"} className="tabular-nums">
                      {counts[s.key]}
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="p-4 md:p-6">
          <DataTable key={active} data={data} loading={loading} />
        </CardContent>
      </Card>

      <div className="sticky bottom-0 z-10 space-y-3 rounded-xl border bg-card p-4 shadow-sm">
        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <legend className="sr-only">أوراق ملف Excel</legend>
          <span className="text-xs font-semibold text-muted-foreground">أوراق Excel:</span>
          {SHEETS.map((s) => (
            <Label key={s.key} htmlFor={`sheet-${s.key}`} className="min-h-11 cursor-pointer gap-2 font-normal">
              <Checkbox
                id={`sheet-${s.key}`}
                checked={sheets.has(s.key)}
                onCheckedChange={(c) => setSheets(toggle(sheets, s.key, c === true))}
              />
              {s.label}
            </Label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="truncate text-sm text-muted-foreground">{summary}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="light" className="h-11 w-full sm:w-auto" onClick={() => download(active)} disabled={busy}>
              <FileSpreadsheet />
              تصدير هذه الورقة ({activeSheet.label})
            </Button>
            <Button className="h-11 w-full sm:w-auto" onClick={() => download()} disabled={busy || sheets.size === 0}>
              <Download />
              {busy ? "جارٍ التجهيز…" : "تصدير Excel"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
