import { useEffect, useState, type FormEvent } from "react"
import { FolderKanban, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Group = { id: number; name: string; user_count: number }

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")

export default function Groups() {
  const [rows, setRows] = useState<Group[] | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Group | null>(null)
  const [name, setName] = useState("")
  const [deleting, setDeleting] = useState<Group | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => api.get("/groups").then(setRows).catch((e) => toast.error(e.message))

  useEffect(() => {
    load()
  }, [])

  const openDialog = (g: Group | null) => {
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
      load()
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
      setDeleting(null)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ")
    }
  }

  const identity = (g: Group) => (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-info-light text-sm font-semibold text-info">
        {initials(g.name)}
      </div>
      <div className="truncate font-medium">{g.name}</div>
    </div>
  )

  const countBadge = (g: Group) => (
    <Badge variant="primary-light">{g.user_count} مستخدم</Badge>
  )

  const actions = (g: Group) => (
    <div className="flex shrink-0 gap-1">
      <Button variant="ghost" size="icon-lg" aria-label={`تعديل ${g.name}`} onClick={() => openDialog(g)}>
        <Pencil />
      </Button>
      <Button variant="ghost" size="icon-lg" aria-label={`حذف ${g.name}`} onClick={() => setDeleting(g)}>
        <Trash2 className="text-destructive" />
      </Button>
    </div>
  )

  return (
    <div className="space-y-4">
      <Card className="gap-0 py-0">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b px-4 py-4 md:px-6 [.border-b]:pb-4">
          <div>
            <div className="text-[1.05rem] font-bold">المجموعات</div>
            <div className="text-xs text-muted-foreground">
              {rows ? `${rows.length} مجموعة` : "جارٍ التحميل…"}
            </div>
          </div>
          <Button className="w-full sm:w-auto" onClick={() => openDialog(null)}>
            <Plus />
            مجموعة جديدة
          </Button>
        </CardHeader>

        <CardContent className="p-0">
          {!rows ? (
            <div className="space-y-3 p-4 md:p-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center">
              <div className="flex size-14 items-center justify-center rounded-lg bg-info-light text-info">
                <FolderKanban className="size-7" />
              </div>
              <p className="text-sm text-muted-foreground">لا توجد مجموعات بعد</p>
              <Button onClick={() => openDialog(null)}>
                <Plus />
                مجموعة جديدة
              </Button>
            </div>
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader className="[&_th]:px-6 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                    <TableRow>
                      <TableHead>الاسم</TableHead>
                      <TableHead>المستخدمون</TableHead>
                      <TableHead className="w-28" />
                    </TableRow>
                  </TableHeader>
                  <TableBody className="[&_td]:px-6 [&_td]:py-3">
                    {rows.map((g) => (
                      <TableRow key={g.id} className="border-dashed">
                        <TableCell>{identity(g)}</TableCell>
                        <TableCell>{countBadge(g)}</TableCell>
                        <TableCell>
                          <div className="flex justify-end">{actions(g)}</div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="divide-y divide-dashed md:hidden">
                {rows.map((g) => (
                  <div key={g.id} className="flex items-center justify-between gap-2 p-4">
                    <div className="min-w-0 space-y-2">
                      {identity(g)}
                      {countBadge(g)}
                    </div>
                    {actions(g)}
                  </div>
                ))}
              </div>
            </>
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
