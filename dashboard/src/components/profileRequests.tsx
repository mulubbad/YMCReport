import { useEffect, useState } from "react"
import { Check, CheckCircle2, ChevronDown, Clock, History, UserRoundPen, X, XCircle } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { fullDate, relTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export type ProfileRequest = {
  id: number
  user_id: number
  changes: Record<string, { from: string; to: string }>
  status: "pending" | "approved" | "declined"
  note: string | null
  reviewed_at: string | null
  created_at: string
  user_name: string
  user_username: string
  reviewer_name: string | null
  user_role: "super" | "admin" | "user"
}

const STATUS = {
  pending: { label: "قيد المراجعة", variant: "warning" as const, Icon: Clock },
  approved: { label: "تمت الموافقة", variant: "success" as const, Icon: CheckCircle2 },
  declined: { label: "مرفوض", variant: "danger" as const, Icon: XCircle },
}
export const FIELD_AR: Record<string, string> = { name: "الاسم", username: "اسم المستخدم" }

export function RequestStatusBadge({ status }: { status: ProfileRequest["status"] }) {
  const s = STATUS[status]
  return (
    <Badge variant={s.variant}>
      <s.Icon />
      {s.label}
    </Badge>
  )
}

export function ChangeLines({ changes }: { changes: ProfileRequest["changes"] }) {
  return (
    <div className="space-y-0.5">
      {Object.entries(changes).map(([f, c]) => (
        <div key={f} className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-xs text-muted-foreground">{FIELD_AR[f] ?? f}:</span>
          <span className="text-muted-foreground line-through" dir={f === "username" ? "ltr" : undefined}>
            {c.from}
          </span>
          <span aria-hidden className="text-muted-foreground">←</span>
          <span className="font-medium" dir={f === "username" ? "ltr" : undefined}>{c.to}</span>
        </div>
      ))}
    </div>
  )
}

// review panel for every leader: pending requests with approve/decline + collapsible history.
// A group admin may only decide a member's request — never their own, never another leader's.
export function RequestsPanel({ onUserChanged }: { onUserChanged: () => void }) {
  const me = useAuth().user!
  const [rows, setRows] = useState<ProfileRequest[]>([])
  const [declining, setDeclining] = useState<ProfileRequest | null>(null)
  const [note, setNote] = useState("")
  const [showHistory, setShowHistory] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = () => api.get("/profile/requests").then(setRows).catch((e) => toast.error(e.message))
  useEffect(() => {
    load()
  }, [])

  const pending = rows.filter((r) => r.status === "pending")
  const history = rows.filter((r) => r.status !== "pending")

  const review = async (r: ProfileRequest, status: "approved" | "declined", reviewNote?: string) => {
    setBusy(true)
    try {
      await api.put(`/profile/requests/${r.id}`, { status, note: reviewNote || null })
      toast.success(status === "approved" ? "تمت الموافقة على الطلب وتطبيق التعديل" : "تم رفض الطلب")
      setDeclining(null)
      setNote("")
      load()
      if (status === "approved") onUserChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "حدث خطأ")
    } finally {
      setBusy(false)
    }
  }

  if (!rows.length) return null
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b px-4 py-4 md:px-6 [.border-b]:pb-4">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary-light text-primary">
            <UserRoundPen className="size-5" />
          </div>
          <div>
            <div className="text-[1.05rem] font-bold">طلبات تعديل البيانات</div>
            <div className="text-xs text-muted-foreground">
              {pending.length ? `${pending.length} طلب بانتظار المراجعة` : "لا توجد طلبات معلّقة"}
            </div>
          </div>
        </div>
        {history.length > 0 && (
          <Button variant="outline" size="sm" aria-expanded={showHistory} onClick={() => setShowHistory((s) => !s)}>
            <History />
            سجل الطلبات ({history.length})
            <ChevronDown className={cn("transition-transform", showHistory && "rotate-180")} />
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {pending.length > 0 && (
          <div className="divide-y divide-dashed">
            {pending.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.user_name}</span>
                    <span className="text-xs text-muted-foreground" dir="ltr">@{r.user_username}</span>
                    <span className="text-xs text-muted-foreground" title={fullDate(r.created_at)}>{relTime(r.created_at)}</span>
                  </div>
                  <ChangeLines changes={r.changes} />
                </div>
                <div className="flex shrink-0 gap-2">
                  {me.role === "super" || (r.user_role === "user" && r.user_id !== me.id) ? (
                    <>
                      <Button size="sm" disabled={busy} onClick={() => review(r, "approved")}>
                        <Check />
                        موافقة
                      </Button>
                      <Button size="sm" variant="outline" className="text-destructive" disabled={busy} onClick={() => setDeclining(r)}>
                        <X />
                        رفض
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">بانتظار مراجعة المشرف العام</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {showHistory && (
          <div className="divide-y divide-dashed border-t border-dashed">
            {history.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.user_name}</span>
                    <span className="text-xs text-muted-foreground" title={r.reviewed_at ? fullDate(r.reviewed_at) : undefined}>
                      {r.reviewer_name ? `راجعه ${r.reviewer_name}` : ""}{r.reviewed_at ? ` · ${relTime(r.reviewed_at)}` : ""}
                    </span>
                  </div>
                  <ChangeLines changes={r.changes} />
                  {r.note && <div className="text-xs text-muted-foreground">ملاحظة: {r.note}</div>}
                </div>
                <RequestStatusBadge status={r.status} />
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={!!declining} onOpenChange={(o) => !o && setDeclining(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>رفض طلب {declining?.user_name}؟</DialogTitle>
            <DialogDescription>سيصل الرفض للمستخدم كإشعار، ويمكنك توضيح السبب.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="decline-note">سبب الرفض (اختياري)</Label>
            <Textarea id="decline-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclining(null)}>إلغاء</Button>
            <Button variant="destructive" disabled={busy} onClick={() => declining && review(declining, "declined", note)}>
              رفض الطلب
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
