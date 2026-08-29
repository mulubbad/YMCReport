import { useEffect, useState, type FormEvent } from "react"
import { CheckCircle2, Copy, Eye, EyeOff, Pencil, Plus, Trash2, Users as UsersIcon, Wand2 } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useScope } from "@/lib/scope"
import { fullDate, minutesSince, relTime } from "@/lib/time"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { RequestsPanel } from "@/components/profileRequests"
import { ActivityDialog, fmtDuration } from "@/components/ActivityDialog"

type UserRow = {
  id: number
  username: string
  name: string
  role: "super" | "admin" | "user"
  group_id: number | null
  group_ids?: number[]          // admins: every group they lead
  active: number
  last_seen_at: string | null
}

const roleVariant = {
  super: "danger",
  admin: "primary-light",
  user: "success",
} as const

const roleLabel = {
  super: "مشرف عام",
  admin: "مدير مجموعة",
  user: "عضو",
} as const

const emptyForm = { username: "", password: "", name: "", role: "user", group_id: "", group_ids: [] as number[] }

// unambiguous alphabet (no 0/O, 1/l/I) so credentials survive being read aloud or handwritten
const genPassword = () => {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"
  return Array.from(crypto.getRandomValues(new Uint32Array(12)), (n) => chars[n % chars.length]).join("")
}

const copyText = (v: string) =>
  navigator.clipboard.writeText(v).then(
    () => toast.success("تم النسخ"),
    () => toast.error("تعذر النسخ — انسخ يدويًا"),
  )

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")

// the auth stamp is throttled to 60s, so anything under 2 min counts as online
const isOnline = (u: { last_seen_at: string | null }) => !!u.last_seen_at && minutesSince(u.last_seen_at) < 2

const lastActive = (u: { last_seen_at: string | null }) =>
  !u.last_seen_at ? (
    <span className="text-xs text-muted-foreground">لم يسجّل الدخول بعد</span>
  ) : isOnline(u) ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
      <span className="relative flex size-2" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />
        <span className="relative inline-flex size-2 rounded-full bg-success" />
      </span>
      متصل الآن
    </span>
  ) : (
    <span className="text-xs text-muted-foreground" title={fullDate(u.last_seen_at)}>
      {relTime(u.last_seen_at)}
    </span>
  )

export default function Users() {
  const me = useAuth().user!
  const isSuper = me.role === "super"
  const { groups, reload: reloadGroups } = useScope()
  const [rows, setRows] = useState<UserRow[] | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [deleting, setDeleting] = useState<UserRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [created, setCreated] = useState<{ name: string; username: string; password: string } | null>(null)
  const [activity, setActivity] = useState<Record<number, { active_days: number; total_seconds: number }>>({})
  const [activityFor, setActivityFor] = useState<UserRow | null>(null)

  const load = () => {
    api.get("/users").then(setRows).catch((e) => toast.error(e.message))
    api
      .get("/activity/summary")
      .then((r: { users: { id: number; active_days: number; total_seconds: number }[] }) =>
        setActivity(Object.fromEntries(r.users.map((u) => [u.id, u]))),
      )
      .catch(() => {})
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 60_000) // keep the monitor's last-active column fresh
    return () => clearInterval(t)
  }, [])

  const groupName = (id: number | null) =>
    groups.find((g) => g.id === id)?.name ?? "—"

  const visible = rows ?? []

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setShowPw(false)
    setOpen(true)
  }

  const openEdit = (u: UserRow) => {
    setEditing(u)
    setForm({
      username: u.username,
      password: "",
      name: u.name,
      role: u.role,
      group_id: u.group_id ? String(u.group_id) : "",
      group_ids: u.group_ids ?? (u.group_id ? [u.group_id] : []),
    })
    setOpen(true)
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const superFields = isSuper
        ? {
            role: form.role,
            group_id: form.group_id ? Number(form.group_id) : null,
            // which groups this admin leads; ignored by the server for other roles
            ...(form.role === "admin" ? { group_ids: form.group_ids } : {}),
          }
        : {}
      if (editing) {
        await api.put(`/users/${editing.id}`, {
          name: form.name,
          username: form.username,
          ...(form.password ? { password: form.password } : {}),
          ...superFields,
        })
      } else {
        await api.post("/users", {
          username: form.username,
          password: form.password,
          name: form.name,
          ...superFields,
        })
        setCreated({ name: form.name, username: form.username, password: form.password })
      }
      toast.success(editing ? "تم تحديث المستخدم" : "تم إنشاء المستخدم")
      setOpen(false)
      load()
      if (isSuper) reloadGroups()   // led-group changes move the workspace switcher
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ")
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (u: UserRow, checked: boolean) => {
    try {
      await api.put(`/users/${u.id}`, { active: checked ? 1 : 0 })
      setRows((r) =>
        r ? r.map((x) => (x.id === u.id ? { ...x, active: checked ? 1 : 0 } : x)) : r,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ")
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await api.del(`/users/${deleting.id}`)
      toast.success("تم حذف المستخدم")
      setDeleting(null)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ")
    }
  }

  const identity = (u: UserRow) => (
    <div className="flex min-w-0 items-center gap-3">
      <div className="relative shrink-0">
        <div className="flex size-10 items-center justify-center rounded-md bg-primary-light text-sm font-semibold text-primary">
          {initials(u.name)}
        </div>
        {isOnline(u) && (
          <span className="absolute -bottom-0.5 -end-0.5 size-3 rounded-full border-2 border-card bg-success" aria-hidden />
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate font-medium">{u.name}</div>
        <div className="truncate text-xs text-muted-foreground" dir="ltr">
          @{u.username}
        </div>
      </div>
    </div>
  )

  const actions = (u: UserRow) => (
    <div className="flex shrink-0 gap-1">
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={`تعديل ${u.name}`}
        onClick={() => openEdit(u)}
      >
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={`حذف ${u.name}`}
        disabled={u.id === me.id}
        onClick={() => setDeleting(u)}
      >
        <Trash2 className="text-destructive" />
      </Button>
    </div>
  )

  // average online time per active day over the last 30 days; click opens the per-day breakdown
  const activityCell = (u: UserRow) => {
    const a = activity[u.id]
    const avg = a && a.active_days ? a.total_seconds / a.active_days : 0
    return (
      <button
        type="button"
        className="cursor-pointer rounded-md text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label={`سجل نشاط ${u.name}`}
        title="عرض النشاط اليومي"
        onClick={() => setActivityFor(u)}
      >
        {avg ? (
          <span className="font-medium tabular-nums">
            {fmtDuration(avg)}
            <span className="font-normal text-muted-foreground"> / يوم</span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </button>
    )
  }

  const activeSwitch = (u: UserRow) => (
    <Switch
      aria-label={`تفعيل ${u.name}`}
      checked={!!u.active}
      disabled={u.id === me.id}
      onCheckedChange={(c) => toggleActive(u, c)}
    />
  )

  return (
    <div className="space-y-4">
      <RequestsPanel onUserChanged={load} />
      <Card className="gap-0 py-0">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b px-4 py-4 md:px-6 [.border-b]:pb-4">
          <div>
            <div className="text-[1.05rem] font-bold">المستخدمون</div>
            <div className="text-xs text-muted-foreground">
              {rows ? `${visible.length} مستخدم` : "جارٍ التحميل…"}
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Button className="w-full sm:w-auto" onClick={openCreate}>
              <Plus />
              مستخدم جديد
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {!rows ? (
            <div className="space-y-3 p-4 md:p-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center">
              <div className="flex size-14 items-center justify-center rounded-lg bg-primary-light text-primary">
                <UsersIcon className="size-7" />
              </div>
              <p className="text-sm text-muted-foreground">لا يوجد مستخدمون بعد</p>
              <Button onClick={openCreate}>
                <Plus />
                مستخدم جديد
              </Button>
            </div>
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader className="[&_th]:px-6 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>المستخدم</TableHead>
                      <TableHead>الدور</TableHead>
                      {isSuper && <TableHead>المجموعة</TableHead>}
                      <TableHead>آخر نشاط</TableHead>
                      <TableHead>متوسط الاستخدام</TableHead>
                      <TableHead>نشط</TableHead>
                      <TableHead className="w-28" />
                    </TableRow>
                  </TableHeader>
                  <TableBody className="[&_td]:px-6 [&_td]:py-3">
                    {visible.map((u, i) => (
                      <TableRow key={u.id} className="border-dashed">
                        <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                        <TableCell>{identity(u)}</TableCell>
                        <TableCell>
                          <Badge variant={roleVariant[u.role]}>{roleLabel[u.role]}</Badge>
                        </TableCell>
                        {isSuper && (
                          <TableCell className="text-muted-foreground">{groupName(u.group_id)}</TableCell>
                        )}
                        <TableCell className="whitespace-nowrap">{lastActive(u)}</TableCell>
                        <TableCell className="whitespace-nowrap">{activityCell(u)}</TableCell>
                        <TableCell>{activeSwitch(u)}</TableCell>
                        <TableCell>
                          <div className="flex justify-end">{actions(u)}</div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="divide-y divide-dashed md:hidden">
                {visible.map((u) => (
                  <div key={u.id} className="space-y-3 p-4">
                    <div className="flex items-center justify-between gap-2">
                      {identity(u)}
                      {actions(u)}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant={roleVariant[u.role]}>{roleLabel[u.role]}</Badge>
                      {isSuper && (
                        <span className="text-xs text-muted-foreground">{groupName(u.group_id)}</span>
                      )}
                      {lastActive(u)}
                      {activityCell(u)}
                      <label className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
                        نشط
                        {activeSwitch(u)}
                      </label>
                    </div>
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
            <DialogTitle>{editing ? "تعديل المستخدم" : "مستخدم جديد"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="u-name">الاسم</Label>
                <Input
                  id="u-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="u-username">اسم المستخدم</Label>
                <Input
                  id="u-username"
                  value={form.username}
                  dir="ltr"
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="u-password">
                  {editing ? "كلمة المرور الجديدة (اتركها فارغة للإبقاء على الحالية)" : "كلمة المرور"}
                </Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="u-password"
                      type={showPw ? "text" : "password"}
                      dir="ltr"
                      autoComplete="new-password"
                      className="pe-9"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      required={!editing}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-0 end-0 size-9"
                      aria-label={showPw ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                      onClick={() => setShowPw((s) => !s)}
                    >
                      {showPw ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="light"
                    onClick={() => {
                      setForm((f) => ({ ...f, password: genPassword() }))
                      setShowPw(true)
                    }}
                  >
                    <Wand2 />
                    توليد
                  </Button>
                </div>
              </div>
              {isSuper && (
                <>
                  <div className="space-y-2">
                    <Label>الدور</Label>
                    <Select
                      value={form.role}
                      onValueChange={(v) => setForm({ ...form, role: v })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">عضو</SelectItem>
                        <SelectItem value="admin">مدير مجموعة</SelectItem>
                        <SelectItem value="super">مشرف عام</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>المجموعة</Label>
                    <Select
                      value={form.group_id || "none"}
                      onValueChange={(v) =>
                        setForm({ ...form, group_id: v === "none" ? "" : v })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">بدون مجموعة</SelectItem>
                        {groups.map((g) => (
                          <SelectItem key={g.id} value={String(g.id)}>
                            {g.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {form.role === "admin" && (
                    <div className="space-y-2 sm:col-span-2">
                      <Label>المجموعات التي يديرها</Label>
                      <p className="text-xs text-muted-foreground">
                        يدير كل مجموعة محدَّدة بالكامل، ويتنقّل بينها من مبدّل مساحة العمل. المجموعة
                        الأساسية أعلاه تُضاف تلقائيًا.
                      </p>
                      <div className="grid gap-1 rounded-md border p-2 sm:grid-cols-2">
                        {groups.length === 0 && (
                          <span className="p-1 text-xs text-muted-foreground">لا توجد مجموعات بعد</span>
                        )}
                        {groups.map((g) => {
                          const primary = String(g.id) === form.group_id
                          const checked = primary || form.group_ids.includes(g.id)
                          return (
                            <label
                              key={g.id}
                              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary/60"
                            >
                              <Checkbox
                                checked={checked}
                                disabled={primary}
                                aria-label={g.name}
                                onCheckedChange={(c) =>
                                  setForm((f) => ({
                                    ...f,
                                    group_ids: c
                                      ? [...new Set([...f.group_ids, g.id])]
                                      : f.group_ids.filter((x) => x !== g.id),
                                  }))
                                }
                              />
                              <span className="min-w-0 truncate">{g.name}</span>
                              {primary && (
                                <span className="ms-auto text-[11px] text-muted-foreground">أساسية</span>
                              )}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <DialogFooter className="sticky bottom-0 bg-background pt-2">
              <Button type="submit" disabled={busy}>
                {editing ? "حفظ" : "إنشاء"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* onboarding summary: credentials shown once after creation */}
      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-success" />
              تم إنشاء المستخدم
            </DialogTitle>
            <DialogDescription>
              شارك بيانات الدخول مع {created?.name} — كلمة المرور لن تظهر مرة أخرى بعد إغلاق هذه النافذة.
            </DialogDescription>
          </DialogHeader>
          {created && (
            <div className="space-y-2">
              {[
                { label: "الرابط", value: window.location.origin },
                { label: "اسم المستخدم", value: created.username },
                { label: "كلمة المرور", value: created.password },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-3 rounded-md border border-dashed px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">{row.label}</p>
                    <p className="truncate text-sm font-medium tabular-nums" dir="ltr">{row.value}</p>
                  </div>
                  <Button variant="ghost" size="icon-lg" aria-label={`نسخ ${row.label}`} onClick={() => copyText(row.value)}>
                    <Copy className="text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreated(null)}>
              إغلاق
            </Button>
            <Button
              onClick={() =>
                created &&
                copyText(`الرابط: ${window.location.origin}\nاسم المستخدم: ${created.username}\nكلمة المرور: ${created.password}`)
              }
            >
              <Copy />
              نسخ بيانات الدخول
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ActivityDialog user={activityFor} onClose={() => setActivityFor(null)} />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف {deleting?.name}؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيؤدي هذا إلى حذف المستخدم نهائيًا مع جميع حساباته وصفحاته.
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
