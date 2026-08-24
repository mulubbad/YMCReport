import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { ExternalLink, Globe, Pencil, Plus, Tags, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type AccountType = { id: number; name: string; allows_pages: number }
type Site = { id: number; name: string; url: string | null }
type Group = { id: number; name: string }

const thClass =
  "[&_th]:px-4 md:[&_th]:px-6 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground"
const tdClass = "[&_td]:px-4 md:[&_td]:px-6 [&_td]:py-3"

function Toolbar({ count, label, onAdd, addLabel }: { count: number | null; label: string; onAdd: () => void; addLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dashed px-4 py-3 md:px-6">
      <span className="text-xs text-muted-foreground">{count === null ? "جارٍ التحميل…" : `${count} ${label}`}</span>
      <Button size="sm" onClick={onAdd}>
        <Plus />
        {addLabel}
      </Button>
    </div>
  )
}

function Empty({ icon, text, onAdd, addLabel }: { icon: ReactNode; text: string; onAdd: () => void; addLabel: string }) {
  return (
    <div className="flex flex-col items-center gap-3 p-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-lg bg-primary-light text-primary">{icon}</div>
      <p className="text-sm text-muted-foreground">{text}</p>
      <Button onClick={onAdd}>
        <Plus />
        {addLabel}
      </Button>
    </div>
  )
}

// gid: selected group for super; "" for admin (server scopes to own group)
function TypesTab({ gid }: { gid: string }) {
  const [rows, setRows] = useState<AccountType[] | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<AccountType | null>(null)
  const [name, setName] = useState("")
  const [allowsPages, setAllowsPages] = useState(false)
  const [deleting, setDeleting] = useState<AccountType | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () =>
    api.get(`/types${gid ? `?group_id=${gid}` : ""}`).then(setRows).catch((e) => toast.error(e.message))

  useEffect(() => {
    load()
  }, [])

  const openDialog = (t: AccountType | null) => {
    setEditing(t)
    setName(t?.name ?? "")
    setAllowsPages(!!t?.allows_pages)
    setOpen(true)
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const body = { name, allows_pages: allowsPages ? 1 : 0, ...(gid ? { group_id: Number(gid) } : {}) }
      if (editing) await api.put(`/types/${editing.id}`, body)
      else await api.post("/types", body)
      toast.success(editing ? "تم تحديث النوع" : "تم إنشاء النوع")
      setOpen(false)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ")
    } finally {
      setBusy(false)
    }
  }

  const togglePages = async (t: AccountType, checked: boolean) => {
    try {
      await api.put(`/types/${t.id}`, { name: t.name, allows_pages: checked ? 1 : 0 })
      setRows((r) =>
        r ? r.map((x) => (x.id === t.id ? { ...x, allows_pages: checked ? 1 : 0 } : x)) : r,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ")
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await api.del(`/types/${deleting.id}`)
      toast.success("تم حذف النوع")
      setDeleting(null)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ")
    }
  }

  // badge is the text signal; switch keeps the inline toggle behavior
  const pages = (t: AccountType) => (
    <div className="flex items-center gap-2">
      <Badge variant={t.allows_pages ? "success" : "danger"}>{t.allows_pages ? "نعم" : "لا"}</Badge>
      <Switch
        aria-label={`يسمح بالصفحات: ${t.name}`}
        checked={!!t.allows_pages}
        onCheckedChange={(c) => togglePages(t, c)}
      />
    </div>
  )

  const actions = (t: AccountType) => (
    <div className="flex shrink-0 gap-1">
      <Button variant="ghost" size="icon-lg" aria-label={`تعديل ${t.name}`} onClick={() => openDialog(t)}>
        <Pencil />
      </Button>
      <Button variant="ghost" size="icon-lg" aria-label={`حذف ${t.name}`} onClick={() => setDeleting(t)}>
        <Trash2 className="text-destructive" />
      </Button>
    </div>
  )

  return (
    <>
      <Toolbar count={rows?.length ?? null} label="نوع" onAdd={() => openDialog(null)} addLabel="إضافة نوع" />
      {!rows ? (
        <div className="p-4 md:p-6"><Skeleton className="h-24 w-full" /></div>
      ) : rows.length === 0 ? (
        <Empty icon={<Tags className="size-7" />} text="لا توجد أنواع حسابات بعد" onAdd={() => openDialog(null)} addLabel="إضافة نوع" />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader className={thClass}>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>يسمح بالصفحات</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody className={tdClass}>
                {rows.map((t, i) => (
                  <TableRow key={t.id} className="border-dashed">
                    <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>{pages(t)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">{actions(t)}</div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="divide-y divide-dashed md:hidden">
            {rows.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 p-4">
                <div className="min-w-0 space-y-2">
                  <div className="truncate font-medium">{t.name}</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    يسمح بالصفحات
                    {pages(t)}
                  </div>
                </div>
                {actions(t)}
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل النوع" : "إضافة نوع"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="t-name">الاسم</Label>
              <Input
                id="t-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="t-pages" checked={allowsPages} onCheckedChange={setAllowsPages} />
              <Label htmlFor="t-pages">يسمح بالصفحات</Label>
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
              ستتأثر الحسابات المرتبطة بهذا النوع، ولا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function SitesTab({ gid }: { gid: string }) {
  const [rows, setRows] = useState<Site[] | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Site | null>(null)
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [deleting, setDeleting] = useState<Site | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () =>
    api.get(`/sites${gid ? `?group_id=${gid}` : ""}`).then(setRows).catch((e) => toast.error(e.message))

  useEffect(() => {
    load()
  }, [])

  const openDialog = (s: Site | null) => {
    setEditing(s)
    setName(s?.name ?? "")
    setUrl(s?.url ?? "")
    setOpen(true)
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const body = { name, url: url || null, ...(gid ? { group_id: Number(gid) } : {}) }
      if (editing) await api.put(`/sites/${editing.id}`, body)
      else await api.post("/sites", body)
      toast.success(editing ? "تم تحديث الموقع" : "تم إنشاء الموقع")
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
      await api.del(`/sites/${deleting.id}`)
      toast.success("تم حذف الموقع")
      setDeleting(null)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ")
    }
  }

  const link = (s: Site) =>
    s.url ? (
      <a
        href={s.url}
        target="_blank"
        rel="noreferrer"
        dir="ltr"
        className="flex min-w-0 items-center gap-1 text-primary hover:underline"
      >
        <ExternalLink className="size-3.5 shrink-0" />
        <span className="truncate">{s.url}</span>
      </a>
    ) : (
      <span className="text-muted-foreground">—</span>
    )

  const actions = (s: Site) => (
    <div className="flex shrink-0 gap-1">
      <Button variant="ghost" size="icon-lg" aria-label={`تعديل ${s.name}`} onClick={() => openDialog(s)}>
        <Pencil />
      </Button>
      <Button variant="ghost" size="icon-lg" aria-label={`حذف ${s.name}`} onClick={() => setDeleting(s)}>
        <Trash2 className="text-destructive" />
      </Button>
    </div>
  )

  return (
    <>
      <Toolbar count={rows?.length ?? null} label="موقع" onAdd={() => openDialog(null)} addLabel="إضافة موقع" />
      {!rows ? (
        <div className="p-4 md:p-6"><Skeleton className="h-24 w-full" /></div>
      ) : rows.length === 0 ? (
        <Empty icon={<Globe className="size-7" />} text="لا توجد مواقع بعد" onAdd={() => openDialog(null)} addLabel="إضافة موقع" />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader className={thClass}>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الرابط</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody className={tdClass}>
                {rows.map((s, i) => (
                  <TableRow key={s.id} className="border-dashed">
                    <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="max-w-[16rem] text-sm">{link(s)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">{actions(s)}</div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="divide-y divide-dashed md:hidden">
            {rows.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 p-4">
                <div className="min-w-0 flex-1 space-y-1 text-sm">
                  <div className="truncate font-medium">{s.name}</div>
                  {link(s)}
                </div>
                {actions(s)}
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل الموقع" : "إضافة موقع"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="s-name">الاسم</Label>
              <Input
                id="s-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-url">الرابط</Label>
              <Input
                id="s-url"
                type="url"
                placeholder="https://…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
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
            <AlertDialogDescription>لا يمكن التراجع عن هذا الإجراء.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

const tabClass =
  "h-auto flex-none rounded-none px-1 pb-3 pt-1 text-sm font-semibold text-muted-foreground group-data-[orientation=horizontal]/tabs:after:bottom-0 after:h-0.5 after:bg-primary data-[state=active]:text-primary"

export default function Settings() {
  const isSuper = useAuth().user!.role === "super"
  const [groups, setGroups] = useState<Group[]>([])
  const [gid, setGid] = useState("")

  useEffect(() => {
    if (isSuper)
      api
        .get("/groups")
        .then((gs: Group[]) => {
          setGroups(gs)
          if (gs[0]) setGid(String(gs[0].id))
        })
        .catch((e) => toast.error(e.message))
  }, [])

  return (
    <Tabs defaultValue="types" className="gap-0">
      <Card className="gap-0 py-0">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b px-4 pt-3 pb-0 md:px-6 [.border-b]:pb-0">
          <TabsList variant="line" className="gap-5 p-0 group-data-[orientation=horizontal]/tabs:h-auto">
            <TabsTrigger value="types" className={tabClass}>
              <Tags />
              أنواع الحسابات
            </TabsTrigger>
            <TabsTrigger value="sites" className={tabClass}>
              <Globe />
              المواقع
            </TabsTrigger>
          </TabsList>
          {isSuper && (
            <Select value={gid} onValueChange={setGid}>
              <SelectTrigger className="mb-3 w-full sm:w-48" aria-label="المجموعة">
                <SelectValue placeholder="اختر مجموعة" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {isSuper && !gid ? (
            <p className="p-6 text-center text-sm text-muted-foreground">أنشئ مجموعة أولًا.</p>
          ) : (
            <>
              <TabsContent value="types">
                <TypesTab key={gid} gid={gid} />
              </TabsContent>
              <TabsContent value="sites">
                <SitesTab key={gid} gid={gid} />
              </TabsContent>
            </>
          )}
        </CardContent>
      </Card>
    </Tabs>
  )
}
