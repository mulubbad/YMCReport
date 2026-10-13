import { cn } from "./utils"

// Date-range presets shared by the dashboard strip and the report screen — local calendar days,
// the same calendar the server's account_daily.day uses.
export const ymd = (d: Date) => d.toLocaleDateString("en-CA")
export const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return ymd(d) }
export const VALID = /^\d{4}-\d{2}-\d{2}$/

export const presetsFor = (today: string) => {
  const month = today.slice(0, 8) + "01", lastMonthEnd = addDays(month, -1)
  return [
    { label: "اليوم", from: today, to: today },
    { label: "7 أيام", from: addDays(today, -6), to: today },
    { label: "30 يوماً", from: addDays(today, -29), to: today },
    { label: "90 يوماً", from: addDays(today, -89), to: today },
    { label: "هذا الشهر", from: month, to: today },
    { label: "الشهر الماضي", from: lastMonthEnd.slice(0, 8) + "01", to: lastMonthEnd },
    { label: "هذه السنة", from: today.slice(0, 5) + "01-01", to: today },
  ]
}

const chip = (on: boolean) =>
  cn(
    "min-h-11 rounded-btn px-3 text-xs font-semibold transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-9",
    on ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-primary-light hover:text-primary",
  )

// quick-range chips; `onClear` adds a leading «كل الفترات» chip (the report screen's empty range = all time)
export function RangePresets({ from, to, onPick, onClear, className }: {
  from: string; to: string; onPick: (from: string, to: string) => void; onClear?: () => void; className?: string
}) {
  const presets = presetsFor(ymd(new Date()))
  return (
    <div role="group" aria-label="نطاق زمني سريع" className={cn("flex flex-wrap gap-2", className)}>
      {onClear && (
        <button type="button" aria-pressed={!from && !to} onClick={onClear} className={chip(!from && !to)}>كل الفترات</button>
      )}
      {presets.map((p) => {
        const on = p.from === from && p.to === to
        return (
          <button key={p.label} type="button" aria-pressed={on} onClick={() => onPick(p.from, p.to)} className={chip(on)}>
            {p.label}
          </button>
        )
      })}
    </div>
  )
}
