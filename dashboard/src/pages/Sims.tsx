import { useEffect, useState, type FormEvent } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  PauseCircle,
  Pencil,
  Plus,
  MessageSquare,
  Search,
  SearchX,
  Smartphone,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
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
import { OwnerOptions, type OwnerGroup, type OwnerUser } from "@/components/OwnerOptions"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { NotesButton, NotesThread } from "@/components/NotesThread"

// ---------- types (CONTRACT.md → SIM lines) ----------

type Carrier = "jawwal" | "ooredoo"
type Status = "active" | "inactive" | "lost"
type Sim = {
  id: number
  user_id: number
  number: string
  carrier: Carrier
  status: Status
  holder_name: string | null
  notes: string | null
  owner_name: string
  linked_accounts: number
  note_count?: number
  created_at: string
}

// same normalization as the server: strip spaces/dashes/parens, +970/00970/970/+972/00972/972 → 0
const normalize = (raw: string) => raw.replace(/[\s\-()]/g, "").replace(/^(\+|00)?97[02]/, "0")
const carrierOf = (n: string): Carrier | null =>
  /^059\d{7}$/.test(n) ? "jawwal" : /^056\d{7}$/.test(n) ? "ooredoo" : null
const INVALID = "يجب أن يبدأ بـ 059 (جوال) أو 056 (أوريدو) ويتكوّن من 10 أرقام"

const CARRIER = {
  jawwal: { label: "جوال", letter: "J", tile: "bg-success text-white", text: "text-success" },
  ooredoo: { label: "أوريدو", letter: "O", tile: "bg-destructive text-white", text: "text-destructive" },
} as const
const STATUS: Record<Status, { label: string; variant: "success" | "secondary" | "danger"; icon: typeof CheckCircle2 }> = {
  active: { label: "نشط", variant: "success", icon: CheckCircle2 },
  inactive: { label: "غير نشط", variant: "secondary", icon: PauseCircle },
  lost: { label: "مفقود", variant: "danger", icon: AlertTriangle },
}
const CHIPS = [
  { key: "all", label: "الكل", match: () => true },
  { key: "jawwal", label: "جوال", match: (s: Sim) => s.carrier === "jawwal" },
  { key: "ooredoo", label: "أوريدو", match: (s: Sim) => s.carrier === "ooredoo" },
  { key: "off", label: "غير نشطة · مفقودة", match: (s: Sim) => s.status !== "active" },
]

const notify = () => window.dispatchEvent(new Event("ymc:refresh"))
const copy = (v: string) =>
  navigator.clipboard.writeText(v).then(
    () => toast.success("تم النسخ"),
    () => toast.error("تعذر النسخ — انسخ الرقم يدويًا"),
  )

const CarrierTile = ({ carrier, size = "size-8" }: { carrier: Carrier; size?: string }) => (
  <span
    aria-hidden
    className={cn("flex shrink-0 items-center justify-center rounded-md text-sm font-bold", size, CARRIER[carrier].tile)}
  >
    {CARRIER[carrier].letter}
  </span>
)

const emptyForm = { number: "", status: "active" as Status, holder_name: "", notes: "", user_id: "" }

export default function Sims() {
  const me = useAuth().user!
  const isAdmin = me.role !== "user"

  const [rows, setRows] = useState<Sim[] | null>(null)
  const [users, setUsers] = useState<OwnerUser[]>([])
  const [groups, setGroups] = useState<OwnerGroup[]>([])
  const [filterUser, setFilterUser] = useState("all")
  const [q, setQ] = useState("")
  const [chip, setChip] = useState("all")

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Sim | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<Sim | null>(null)
  const [notesFor, setNotesFor] = useState<Sim | null>(null)

  const load = () =>
    api
      .get(`/sims${filterUser !== "all" ? `?user_id=${filterUser}` : ""}`)
      .then(setRows)
      .catch((e) => toast.error(e.message))
  useEffect(() => {
    load()
  }, [filterUser])

  useEffect(() => {
    if (isAdmin) api.get("/users").then(setUsers).catch((e) => toast.error(e.message))
    if (me.role === "super") api.get("/groups").then(setGroups).catch((e) => toast.error(e.message))
  }, [isAdmin, me.role])

  const ownerOptions = <OwnerOptions users={users} groups={groups} meId={me.id} />

  const s = q.trim().toLowerCase()
  const chipMatch = CHIPS.find((c) => c.key === chip)!.match
  const visible = (rows ?? []).filter(
    (r) => chipMatch(r) && (!s || [r.number, r.holder_name, r.owner_name].some((v) => v?.toLowerCase().includes(s))),
  )
  const count = (key: string) => (rows ?? []).filter(CHIPS.find((c) => c.key === key)!.match).length

  const openDialog = (sim: Sim | null) => {
    setEditing(sim)
    setForm(
      sim
        ? { number: sim.number, status: sim.status, holder_name: sim.holder_name ?? "", notes: sim.notes ?? "", user_id: String(sim.user_id) }
        : { ...emptyForm, user_id: String(me.id) },
    )
    setOpen(true)
  }

  const number = normalize(form.number)
  const detected = carrierOf(number)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!detected) return toast.error(`رقم الجوال غير صالح — ${INVALID}`)
    setBusy(true)
    const body: Record<string, unknown> = {
      number,
      status: form.status,
      holder_name: form.holder_name.trim() || null,
      notes: form.notes.trim() || null,
    }
    if (isAdmin && form.user_id) body.user_id = Number(form.user_id)
    try {
      if (editing) await api.put(`/sims/${editing.id}`, body)
      else await api.post("/sims", body)
      toast.success(editing ? "تم حفظ الخط" : "تمت إضافة الخط")
      setOpen(false)
      notify()
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر حفظ الخط — حاول مرة أخرى")
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await api.del(`/sims/${deleting.id}`)
      toast.success("تم حذف الخط")
      setDeleting(null)
      notify()
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر حذف الخط — حاول مرة أخرى")
    }
  }

  // ----- shared cells (table + mobile cards) -----
  const numberCell = (r: Sim) => (
    <div className="flex items-center gap-1">
      <span dir="ltr" className="font-medium tabular-nums">{r.number}</span>
      <Button variant="ghost" size="icon-lg" aria-label={`نسخ الرقم ${r.number}`} onClick={() => copy(r.number)}>
        <Copy className="size-4 text-muted-foreground" />
      </Button>
    </div>
  )
  const carrierCell = (r: Sim) => (
    <div className="flex items-center gap-2">
      <CarrierTile carrier={r.carrier} />
      <span className={cn("font-medium", CARRIER[r.carrier].text)}>{CARRIER[r.carrier].label}</span>
    </div>
  )
  const statusCell = (r: Sim) => {
    const st = STATUS[r.status]
    return (
      <Badge variant={st.variant}>
        <st.icon aria-hidden />
        {st.label}
      </Badge>
    )
  }
  const linkedCell = (r: Sim) =>
    r.linked_accounts ? <Badge variant="primary-light">{r.linked_accounts} حساب</Badge> : <span className="text-muted-foreground">—</span>
  const actions = (r: Sim) => (
    <div className="flex shrink-0 gap-1">
      <NotesButton count={r.note_count} label={`الملاحظات الخاصة على ${r.number}`} onClick={() => setNotesFor(r)} />
      <Button variant="ghost" size="icon-lg" aria-label={`تعديل الخط ${r.number}`} onClick={() => openDialog(r)}>
        <Pencil />
      </Button>
      <Button variant="ghost" size="icon-lg" aria-label={`حذف الخط ${r.number}`} onClick={() => setDeleting(r)}>
        <Trash2 className="text-destructive" />
      </Button>
    </div>
  )

  const addButton = (
    <Button className="h-11 w-full sm:w-auto" onClick={() => openDialog(null)}>
      <Plus />
      إضافة خط
    </Button>
  )

  return (
    <div className="space-y-4">
      <Card className="gap-0 py-0">
        <CardHeader className="flex flex-col gap-3 border-b px-4 py-4 md:px-6 [.border-b]:pb-4">
          <div className="flex flex-row flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[1.05rem] font-bold">خطوط الاتصال</div>
              <div className="text-xs text-muted-foreground">{rows ? `${rows.length} خط` : "جارٍ التحميل…"}</div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-56">
                <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="بحث بالرقم أو اسم المالك"
                  placeholder="بحث بالرقم أو الاسم…"
                  className="h-11 ps-9"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              {isAdmin && (
                <Select value={filterUser} onValueChange={setFilterUser}>
                  <SelectTrigger className="h-11 w-full sm:w-44" aria-label="تصفية حسب المالك">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل المالكين</SelectItem>
                    {ownerOptions}
                  </SelectContent>
                </Select>
              )}
              {addButton}
            </div>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="تصفية سريعة">
            {CHIPS.map((c) => (
              <button
                key={c.key}
                type="button"
                aria-pressed={chip === c.key}
                onClick={() => setChip(c.key)}
                className={cn(
                  "inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-btn border px-3 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  chip === c.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {c.label}
                <span className={cn("rounded-full px-1.5 text-xs tabular-nums", chip === c.key ? "bg-white/20" : "bg-muted")}>
                  {rows ? count(c.key) : "…"}
                </span>
              </button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {!rows ? (
            <div className="space-y-3 p-4 md:p-6">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center">
              <div className="flex size-14 items-center justify-center rounded-lg bg-primary-light text-primary">
                <Smartphone className="size-7" />
              </div>
              <p className="text-sm text-muted-foreground">لا توجد خطوط بعد — أضف أول خط تحمله</p>
              {addButton}
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center">
              <div className="flex size-14 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <SearchX className="size-7" />
              </div>
              <p className="text-sm text-muted-foreground">لا توجد خطوط مطابقة — غيّر البحث أو التصفية</p>
            </div>
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader className="[&_th]:px-6 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>الرقم</TableHead>
                      <TableHead>الشركة</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>اسم المالك المسجّل</TableHead>
                      <TableHead>الحسابات المرتبطة</TableHead>
                      {isAdmin && <TableHead>المالك</TableHead>}
                      <TableHead>ملاحظات</TableHead>
                      <TableHead className="w-36" />
                    </TableRow>
                  </TableHeader>
                  <TableBody className="[&_td]:px-6 [&_td]:py-3">
                    {visible.map((r, i) => (
                      <TableRow key={r.id} className="border-dashed">
                        <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                        <TableCell className="whitespace-nowrap">{numberCell(r)}</TableCell>
                        <TableCell className="whitespace-nowrap">{carrierCell(r)}</TableCell>
                        <TableCell>{statusCell(r)}</TableCell>
                        <TableCell className="max-w-[12rem] truncate" title={r.holder_name ?? ""}>
                          {r.holder_name || <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>{linkedCell(r)}</TableCell>
                        {isAdmin && <TableCell className="whitespace-nowrap">{r.owner_name}</TableCell>}
                        <TableCell className="max-w-[14rem] truncate text-muted-foreground" title={r.notes ?? ""}>
                          {r.notes || "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end">{actions(r)}</div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="divide-y divide-dashed md:hidden">
                {visible.map((r) => (
                  <div key={r.id} className="flex items-start justify-between gap-2 p-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <CarrierTile carrier={r.carrier} size="size-10" />
                        <div className="min-w-0">
                          {numberCell(r)}
                          <div className={cn("text-xs font-medium", CARRIER[r.carrier].text)}>{CARRIER[r.carrier].label}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {statusCell(r)}
                        {linkedCell(r)}
                      </div>
                      <div className="truncate text-sm">
                        {r.holder_name || <span className="text-muted-foreground">بدون اسم مسجّل</span>}
                        {isAdmin && <span className="text-muted-foreground"> · {r.owner_name}</span>}
                      </div>
                      {r.notes && <div className="truncate text-xs text-muted-foreground">{r.notes}</div>}
                    </div>
                    {actions(r)}
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل الخط" : "إضافة خط"}</DialogTitle>
            <DialogDescription>يُكتشف مشغّل الشبكة تلقائيًا من بداية الرقم.</DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            {isAdmin && (
              <div className="space-y-2">
                <Label>المالك</Label>
                <Select value={form.user_id} onValueChange={(v) => setForm({ ...form, user_id: v })}>
                  <SelectTrigger className="h-11 w-full" aria-label="مالك الخط">
                    <SelectValue placeholder="اختر المالك" />
                  </SelectTrigger>
                  <SelectContent>{ownerOptions}</SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="sim-number">رقم الجوال</Label>
              <Input
                id="sim-number"
                dir="ltr"
                inputMode="tel"
                autoComplete="off"
                placeholder="059XXXXXXX"
                className="h-11 tabular-nums"
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
                aria-describedby="sim-carrier"
                aria-invalid={form.number.trim() !== "" && !detected}
                required
                autoFocus
              />
              <div id="sim-carrier" className="flex min-h-6 items-center gap-2 text-sm" aria-live="polite">
                {detected ? (
                  <>
                    <CarrierTile carrier={detected} size="size-6" />
                    <span className={cn("font-medium", CARRIER[detected].text)}>{CARRIER[detected].label}</span>
                    {number !== form.number.trim() && (
                      <span dir="ltr" className="text-xs text-muted-foreground tabular-nums">→ {number}</span>
                    )}
                  </>
                ) : (
                  <span className={cn("text-xs", form.number.trim() ? "text-destructive" : "text-muted-foreground")}>{INVALID}</span>
                )}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>الحالة</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as Status })}>
                  <SelectTrigger className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS) as Status[]).map((k) => (
                      <SelectItem key={k} value={k}>{STATUS[k].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sim-holder">اسم المالك المسجّل</Label>
                <Input
                  id="sim-holder"
                  className="h-11"
                  value={form.holder_name}
                  onChange={(e) => setForm({ ...form, holder_name: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sim-notes">ملاحظات</Label>
              <Textarea id="sim-notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(false)}>
                إلغاء
              </Button>
              <Button type="submit" className="h-11" disabled={busy}>
                {busy ? "جارٍ الحفظ…" : editing ? "حفظ الخط" : "إضافة خط"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!notesFor} onOpenChange={(o) => !o && setNotesFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="size-5 text-primary" />
              الملاحظات الخاصة — <span dir="ltr" className="tabular-nums">{notesFor?.number}</span>
            </DialogTitle>
            <DialogDescription>محادثة خاصة حول خط الاتصال بين صاحبه وقادة مجموعته.</DialogDescription>
          </DialogHeader>
          {notesFor && <NotesThread type="sim" id={notesFor.id} title={notesFor.number} onChange={load} />}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              حذف الخط <span dir="ltr" className="tabular-nums">{deleting?.number}</span>؟
            </AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف الخط من القائمة. الحسابات المرتبطة به لن تُحذف ولن يتغيّر رقم الجوال فيها.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
