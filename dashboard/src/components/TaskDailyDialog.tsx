import { useEffect, useState } from "react"
import { CalendarRange, Repeat } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
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

const dayStr = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)

type DayRow = { day: string; done: number; total: number; names: string[] }

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-dashed p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
    </div>
  )
}

// admin view: per-day completion of a daily task with date-range filtering
export function TaskDailyDialog({ task, onClose }: { task: { id: number; title: string } | null; onClose: () => void }) {
  const [from, setFrom] = useState(dayStr(-29))
  const [to, setTo] = useState(dayStr(0))
  const [data, setData] = useState<{ total: number; days: DayRow[] } | null>(null)

  useEffect(() => {
    if (!task) return
    setData(null)
    api
      .get(`/tasks/${task.id}/daily?from=${from}&to=${to}`)
      .then(setData)
      .catch((e) => toast.error(e.message))
  }, [task, from, to])

  const days = data?.days ?? []
  const pct = (d: DayRow) => (d.total ? Math.round((d.done / d.total) * 100) : 0)
  const avg = days.length ? Math.round(days.reduce((s, d) => s + pct(d), 0) / days.length) : 0
  const fullDays = days.filter((d) => d.total > 0 && d.done === d.total).length
  const weekday = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("ar", { weekday: "long" })

  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="size-5 text-info" />
            الإنجاز اليومي — {task?.title}
          </DialogTitle>
          <DialogDescription>يُعاد ضبط الإنجاز كل يوم — هذا سجل من أنجز المهمة في كل يوم ضمن النطاق.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="td-from">من</Label>
            <Input id="td-from" type="date" max={to} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="td-to">إلى</Label>
            <Input id="td-to" type="date" min={from} max={dayStr(0)} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </div>
        </div>

        {!data ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <StatTile label="أيام فيها إنجاز" value={String(days.length)} />
              <StatTile label="متوسط الإنجاز" value={`${avg}%`} />
              <StatTile label="أيام مكتملة" value={String(fullDays)} />
            </div>

            {days.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center">
                <CalendarRange className="size-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">لا يوجد إنجاز مسجّل في هذا النطاق.</p>
              </div>
            ) : (
              <div className="space-y-1" role="list" aria-label="الإنجاز اليومي">
                {days.map((d) => (
                  <div key={d.day} role="listitem" className="rounded-md px-1 py-1.5">
                    <div className="flex items-center gap-3">
                      <div className="w-28 shrink-0">
                        <div className="truncate text-sm font-medium">{weekday(d.day)}</div>
                        <div className="text-xs text-muted-foreground tabular-nums" dir="ltr">{d.day}</div>
                      </div>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn("h-full rounded-full", d.done === d.total ? "bg-success" : "bg-primary")}
                          style={{ width: `${pct(d)}%` }}
                        />
                      </div>
                      <div className="w-14 shrink-0 text-end text-sm font-medium tabular-nums">
                        {d.done}/{d.total}
                      </div>
                    </div>
                    <div className="ps-28 pt-0.5 text-xs text-muted-foreground" title={d.names.join("، ")}>
                      <span className="line-clamp-1">{d.names.join("، ")}</span>
                    </div>
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
