import { useEffect, useState, type FormEvent } from "react"
import { CalendarDays, Clock, Eye, EyeOff, History, KeyRound, Send, UserRoundPen } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { fullDate, relDays, relTime } from "@/lib/time"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ChangeLines, RequestStatusBadge, type ProfileRequest } from "@/components/profileRequests"

type Me = {
  id: number
  username: string
  name: string
  role: "super" | "admin" | "user"
  group_id: number | null
  last_seen_at: string | null
  created_at: string
}

const roleMeta = {
  super: { label: "مشرف عام", variant: "danger" },
  admin: { label: "مدير مجموعة", variant: "primary-light" },
  user: { label: "عضو", variant: "success" },
} as const

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("")

export default function Profile() {
  const { user, refresh } = useAuth()
  const isSuper = user!.role === "super"

  const [me, setMe] = useState<Me | null>(null)
  const [requests, setRequests] = useState<ProfileRequest[] | null>(null)
  const [name, setName] = useState("")
  const [username, setUsername] = useState("")
  const [busy, setBusy] = useState(false)
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" })
  const [showPw, setShowPw] = useState(false)
  const [pwBusy, setPwBusy] = useState(false)

  const load = () => {
    api
      .get("/me")
      .then((m: Me) => {
        setMe(m)
        setName(m.name)
        setUsername(m.username)
      })
      .catch((e) => toast.error(e.message))
    api.get("/profile/requests").then(setRequests).catch((e) => toast.error(e.message))
    refresh().catch(() => {})
  }
  useEffect(load, [])

  const mine = (requests ?? []).filter((r) => r.user_id === user!.id)
  const pendingReq = mine.find((r) => r.status === "pending")
  const dirty = me != null && (name.trim() !== me.name || username.trim() !== me.username)

  const submitProfile = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (isSuper) {
        await api.put(`/users/${user!.id}`, { name: name.trim() })
        toast.success("تم حفظ التعديلات")
      } else {
        await api.post("/profile/requests", { name: name.trim(), username: username.trim() })
        toast.success("أُرسل الطلب إلى المشرف العام للمراجعة")
      }
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ")
    } finally {
      setBusy(false)
    }
  }

  const changePassword = async (e: FormEvent) => {
    e.preventDefault()
    if (pw.next !== pw.confirm) return toast.error("تأكيد كلمة المرور غير مطابق")
    setPwBusy(true)
    try {
      await api.put(`/users/${user!.id}`, { password: pw.next, current_password: pw.current })
      toast.success("تم تغيير كلمة المرور")
      setPw({ current: "", next: "", confirm: "" })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ")
    } finally {
      setPwBusy(false)
    }
  }

  if (!me)
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )

  const role = roleMeta[me.role]
  return (
    <div className="space-y-4">
      {/* identity */}
      <Card className="py-0">
        <CardContent className="flex flex-wrap items-center gap-4 p-4 md:p-6">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-primary-light text-xl font-bold text-primary">
            {initials(me.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-lg font-bold">{me.name}</span>
              <Badge variant={role.variant}>{role.label}</Badge>
            </div>
            <div className="text-sm text-muted-foreground text-end" dir="ltr">@{me.username}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1" title={fullDate(me.created_at)}>
                <CalendarDays className="size-3.5" />
                انضم {relDays(me.created_at)}
              </span>
              {me.last_seen_at && (
                <span className="inline-flex items-center gap-1" title={fullDate(me.last_seen_at)}>
                  <Clock className="size-3.5" />
                  آخر نشاط {relTime(me.last_seen_at)}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* profile data */}
        <Card className="gap-0 py-0">
          <CardHeader className="flex flex-row items-center gap-2 border-b px-4 py-4 md:px-6 [.border-b]:pb-4">
            <UserRoundPen className="size-5 text-primary" />
            <div>
              <div className="font-bold">البيانات الشخصية</div>
              <div className="text-xs text-muted-foreground">
                {isSuper ? "تُحفظ تعديلاتك مباشرة." : "تُرسل التعديلات كطلب يراجعه المشرف العام."}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 md:p-6">
            {pendingReq && (
              <div className="mb-4 space-y-1 rounded-md border border-warning/40 bg-warning-light p-3" role="status">
                <div className="text-sm font-semibold text-warning">لديك طلب قيد المراجعة</div>
                <ChangeLines changes={pendingReq.changes} />
                <div className="text-xs text-muted-foreground" title={fullDate(pendingReq.created_at)}>
                  أُرسل {relTime(pendingReq.created_at)}
                </div>
              </div>
            )}
            <form onSubmit={submitProfile} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="p-name">الاسم</Label>
                <Input id="p-name" value={name} disabled={!!pendingReq} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-username">اسم المستخدم</Label>
                <Input
                  id="p-username"
                  dir="ltr"
                  value={username}
                  disabled={isSuper || !!pendingReq}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
                {isSuper && <p className="text-xs text-muted-foreground">اسم مستخدم المشرف العام ثابت.</p>}
              </div>
              <Button type="submit" disabled={busy || !dirty || !!pendingReq}>
                <Send />
                {isSuper ? "حفظ" : "إرسال طلب التعديل"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* password */}
        <Card className="gap-0 py-0">
          <CardHeader className="flex flex-row items-center gap-2 border-b px-4 py-4 md:px-6 [.border-b]:pb-4">
            <KeyRound className="size-5 text-primary" />
            <div>
              <div className="font-bold">تغيير كلمة المرور</div>
              <div className="text-xs text-muted-foreground">يسري التغيير فورًا دون الحاجة لموافقة.</div>
            </div>
          </CardHeader>
          <CardContent className="p-4 md:p-6">
            <form onSubmit={changePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="p-current">كلمة المرور الحالية</Label>
                <Input
                  id="p-current"
                  type="password"
                  autoComplete="current-password"
                  value={pw.current}
                  onChange={(e) => setPw({ ...pw, current: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="p-next">كلمة المرور الجديدة</Label>
                  <div className="relative">
                    <Input
                      id="p-next"
                      type={showPw ? "text" : "password"}
                      autoComplete="new-password"
                      className="pe-9"
                      value={pw.next}
                      onChange={(e) => setPw({ ...pw, next: e.target.value })}
                      required
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
                </div>
                <div className="space-y-2">
                  <Label htmlFor="p-confirm">تأكيد كلمة المرور</Label>
                  <Input
                    id="p-confirm"
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    value={pw.confirm}
                    aria-invalid={pw.confirm !== "" && pw.confirm !== pw.next}
                    onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                    required
                  />
                </div>
              </div>
              <Button type="submit" disabled={pwBusy}>
                <KeyRound />
                تغيير كلمة المرور
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* change history */}
      {!isSuper && (
        <Card className="gap-0 py-0">
          <CardHeader className="flex flex-row items-center gap-2 border-b px-4 py-4 md:px-6 [.border-b]:pb-4">
            <History className="size-5 text-primary" />
            <div>
              <div className="font-bold">سجل طلبات التعديل</div>
              <div className="text-xs text-muted-foreground">
                {requests ? `${mine.length} طلب` : "جارٍ التحميل…"}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!requests ? (
              <div className="p-4 md:p-6"><Skeleton className="h-16 w-full" /></div>
            ) : mine.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">لا توجد طلبات بعد — عدّل بياناتك أعلاه لإرسال أول طلب.</p>
            ) : (
              <div className="divide-y divide-dashed">
                {mine.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
                    <div className="min-w-0 space-y-1">
                      <ChangeLines changes={r.changes} />
                      <div className="text-xs text-muted-foreground" title={fullDate(r.created_at)}>
                        أُرسل {relTime(r.created_at)}
                        {r.reviewer_name && r.reviewed_at && ` · راجعه ${r.reviewer_name} ${relTime(r.reviewed_at)}`}
                      </div>
                      {r.note && <div className="text-xs text-muted-foreground">ملاحظة المراجع: {r.note}</div>}
                    </div>
                    <RequestStatusBadge status={r.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
