import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import {
  AtSign,
  ClipboardList,
  Download,
  FolderKanban,
  LogIn,
  Pencil,
  Plus,
  Smartphone,
  Trash2,
  Users,
} from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useScope, type ManagedGroup } from "@/lib/scope"
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")

// the four numbers that say "what lives in this group"
const STATS = [
  { key: "member_count", label: "الأعضاء", icon: Users, tint: "bg-primary-light text-primary" },
  { key: "account_count", label: "الحسابات", icon: AtSign, tint: "bg-success-light text-success" },
  { key: "sim_count", label: "خطوط الاتصال", icon: Smartphone, tint: "bg-info-light text-info" },
  { key: "task_count", label: "مهام نشطة", icon: ClipboardList, tint: "bg-warning-light text-warning" },
] as const

// where "enter this group" can drop you — the group's own copy of each screen
const ENTRIES = [
  { to: "/", label: "لوحة التحكم" },
  { to: "/users", label: "المستخدمون" },
  { to: "/tasks", label: "المهام" },
  { to: "/export", label: "التقارير", icon: Download },
] as const

export default function Groups() {
  const me = useAuth().user!
  const isSuper = me.role === "super"
  const { groups, gid, setGid, loading, reload } = useScope()
  const navigate = useNavigate()

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ManagedGroup | null>(null)
  const [name, setName] = useState("")
  const [deleting, setDeleting] = useState<ManagedGroup | null>(null)
  const [busy, setBusy] = useState(false)

  const openDialog = (g: ManagedGroup | null) => {
    setEditing(g)
    setName(g?.name ?? "")
    setOpen(true)
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (editing) await api.put(`/groups/${editing.id}`, { name })
      else await api.post("/groups", { name })
      toast.success(editing ? "تم تحديث المجموعة" : "تم إنشاء المجموعة")
      setOpen(false)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ")
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await api.del(`/groups/${deleting.id}`)
      toast.success("تم حذف المجموعة")
      if (gid === deleting.id) setGid(null)
      setDeleting(null)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ")
    }
  }

  // entering a group switches the whole app into it, then lands on the requested screen
  const enter = (g: ManagedGroup, to: string) => {
    setGid(g.id)
    window.dispatchEvent(new Event("ymc:refresh"))
    navigate(to)
  }

  return (
    <div className="space-y-4">
      <Card className="gap-0 py-0">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b px-4 py-4 md:px-6 [.border-b]:pb-4">
          <div>
            <div className="text-[1.05rem] font-bold">
              {isSuper ? "المجموعات" : "المجموعات التي تديرها"}
            </div>
            <div className="text-xs text-muted-foreground">
              {loading
                ? "جارٍ التحميل…"
                : `${groups.length} مجموعة — ادخل إلى مجموعة لإدارتها بالكامل`}
            </div>
          </div>
          {isSuper && (
            <Button className="w-full sm:w-auto" onClick={() => openDialog(null)}>
              <Plus />
              مجموعة جديدة
            </Button>
          )}
        </CardHeader>

        <CardContent className="p-4 md:p-6">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Skeleton className="h-56 w-full" />
              <Skeleton className="h-56 w-full" />
              <Skeleton className="h-56 w-full" />
            </div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center">
              <div className="flex size-14 items-center justify-center rounded-lg bg-info-light text-info">
                <FolderKanban className="size-7" />
              </div>
              <p className="text-sm text-muted-foreground">
                {isSuper ? "لا توجد مجموعات بعد" : "لم تُسنَد إليك أي مجموعة بعد — تواصل مع المشرف العام"}
              </p>
              {isSuper && (
                <Button onClick={() => openDialog(null)}>
                  <Plus />
                  مجموعة جديدة
                </Button>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {groups.map((g) => {
                const current = g.id === gid
                return (
                  <div
                    key={g.id}
                    className={cn(
                      "flex flex-col gap-4 rounded-lg border bg-card p-4 transition-colors duration-150",
                      current ? "border-primary ring-1 ring-primary" : "hover:border-primary/40",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-white">
                        {initials(g.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold">{g.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {g.user_count} مستخدم
                        </div>
                      </div>
                      {current && <Badge variant="primary-light">مساحة العمل الحالية</Badge>}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {STATS.map(({ key, label, icon: Icon, tint }) => (
                        <div key={key} className="flex items-center gap-2 rounded-md bg-secondary/50 px-2.5 py-2">
                          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", tint)}>
                            <Icon className="size-4" aria-hidden />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm leading-tight font-bold tabular-nums">{g[key]}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">{label}</span>
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-auto space-y-2">
                      <Button className="w-full" onClick={() => enter(g, "/")} disabled={current}>
                        <LogIn />
                        {current ? "أنت داخل هذه المجموعة" : "الدخول إلى المجموعة"}
                      </Button>
                      <div className="flex flex-wrap items-center gap-1">
                        {ENTRIES.slice(1).map((e) => (
                          <Button
                            key={e.to}
                            variant="light"
                            size="sm"
                            className="flex-1"
                            onClick={() => enter(g, e.to)}
                          >
                            {e.label}
                          </Button>
                        ))}
                        {isSuper && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon-lg"
                              aria-label={`تعديل ${g.name}`}
                              onClick={() => openDialog(g)}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-lg"
                              aria-label={`حذف ${g.name}`}
                              onClick={() => setDeleting(g)}
                            >
                              <Trash2 className="text-destructive" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل المجموعة" : "مجموعة جديدة"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="g-name">الاسم</Label>
              <Input
                id="g-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {editing ? "حفظ" : "إنشاء"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف {deleting?.name}؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيؤدي هذا إلى حذف المجموعة مع أنواع الحسابات والمواقع والمهام التابعة لها،
              وسيبقى مستخدموها دون مجموعة.
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
