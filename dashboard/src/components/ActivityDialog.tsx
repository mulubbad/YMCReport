import { useEffect, useState } from "react"
import { CalendarRange, Clock } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"

export const fmtDuration = (s: number) =>
  s < 3600 ? `${Math.round(s / 60)} د` : `${(s / 3600).toFixed(1).replace(/\.0$/, "")} س`

const dayStr = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)

type DayRow = { day: string; seconds: number }

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-dashed p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
    </div>
  )
}

// per-day online hours for one user, with date-range filtering
export function ActivityDialog({ user, onClose }: { user: { id: number; name: string } | null; onClose: () => void }) {
  const [from, setFrom] = useState(dayStr(-29))
  const [to, setTo] = useState(dayStr(0))
  const [days, setDays] = useState<DayRow[] | null>(null)

  useEffect(() => {
    if (!user) return
    setDays(null)
    api
      .get(`/activity/${user.id}?from=${from}&to=${to}`)
      .then((r: { days: DayRow[] }) => setDays(r.days))
      .catch((e) => toast.error(e.message))
  }, [user, from, to])

  const total = (days ?? []).reduce((s, d) => s + d.seconds, 0)
  const max = Math.max(1, ...(days ?? []).map((d) => d.seconds))
  const weekday = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("ar", { weekday: "long" })

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="size-5 text-primary" />
            نشاط {user?.name}
          </DialogTitle>
          <DialogDescription>ساعات الاستخدام داخل التطبيق لكل يوم ضمن النطاق المحدد.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="act-from">من</Label>
            <Input id="act-from" type="date" max={to} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="act-to">إلى</Label>
            <Input id="act-to" type="date" min={from} max={dayStr(0)} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </div>
        </div>

        {!days ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <StatTile label="المجموع" value={total ? fmtDuration(total) : "0"} />
              <StatTile label="أيام نشطة" value={String(days.length)} />
              <StatTile label="متوسط اليوم النشط" value={days.length ? fmtDuration(total / days.length) : "—"} />
            </div>

            {days.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center">
                <CalendarRange className="size-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">لا يوجد نشاط مسجّل في هذا النطاق.</p>
              </div>
            ) : (
              <div className="space-y-1" role="list" aria-label="النشاط اليومي">
                {days.map((d) => (
                  <div key={d.day} role="listitem" className="flex items-center gap-3 rounded-md px-1 py-1.5">
                    <div className="w-28 shrink-0">
                      <div className="truncate text-sm font-medium">{weekday(d.day)}</div>
                      <div className="text-xs text-muted-foreground tabular-nums" dir="ltr">{d.day}</div>
                    </div>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(d.seconds / max) * 100}%` }} />
                    </div>
                    <div className="w-14 shrink-0 text-end text-sm font-medium tabular-nums">{fmtDuration(d.seconds)}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
