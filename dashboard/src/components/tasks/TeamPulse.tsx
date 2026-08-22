// Team pulse: per-member completion board (everyone in the group) + weekly 3P digest for admins
import { useState } from "react"
import { toast } from "sonner"
import { Copy, FileText, Share2, Trophy, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CARD, ProgressRing, arCount, arDate, arDays, dayDiff, initials, type Task, type Team } from "./shared"

// Progress / Plans / Problems — the 3P internal-update format, computed from what's on screen
export function buildDigest(team: Team, tasks: Task[], today: string, isCompleted: (t: Task) => boolean) {
  const from = new Date(Date.parse(today) - 6 * 86400000).toISOString().slice(0, 10)
  const range = `${arDate(from)} – ${arDate(today)}`
  const done = tasks.filter(isCompleted)
  const open = tasks.filter((t) => !isCompleted(t))
  const pct = tasks.length ? Math.round((done.length / tasks.length) * 100) : 0
  const sumDone = team.members.reduce((a, m) => a + m.done, 0)
  const sumTotal = team.members.reduce((a, m) => a + m.total, 0)
  const teamPct = sumTotal ? Math.round((sumDone / sumTotal) * 100) : 0
  const top = [...team.members].sort((a, b) => b.done - a.done)[0]
  const dueOf = (t: Task) => t.due_date!.slice(0, 10)
  const upcoming = open
    .filter((t) => t.due_date && dayDiff(dueOf(t), today) >= 0 && dayDiff(dueOf(t), today) <= 7)
    .sort((a, b) => dueOf(a).localeCompare(dueOf(b)))
  const overdue = open.filter((t) => t.due_date && dayDiff(dueOf(t), today) < 0).sort((a, b) => dueOf(a).localeCompare(dueOf(b)))
  const idle = team.members.filter((m) => m.total > 0 && m.done === 0).length
  const tasksN = (n: number) => arCount(n, "مهمة واحدة", "مهمتان", "مهام", "مهمة")
  const list = (xs: Task[], f: (t: Task) => string) => {
    const head = xs.slice(0, 3).map(f).join("، ")
    return xs.length > 3 ? `${head} و${tasksN(xs.length - 3)} أخرى` : head
  }

  const progress = tasks.length
    ? `اكتمل ${done.length} من ${tasksN(tasks.length)} نشطة (${pct}%)، ومعدل إنجاز الأعضاء ${teamPct}%.` +
      (top && top.done > 0 ? ` الأعلى إنجازًا: ${top.name} (${top.done}/${top.total}).` : "")
    : "لا توجد مهام نشطة هذا الأسبوع."
  const plans = upcoming.length
    ? `${tasksN(upcoming.length)} تستحق خلال الأسبوع القادم: ${list(upcoming, (t) => `${t.title} (${arDate(dueOf(t))})`)}.`
    : open.length
      ? `لا استحقاقات قريبة؛ التركيز على إنهاء ${tasksN(open.length)} جارية.`
      : "لا مهام معلّقة — جاهزون لدفعة جديدة."
  const problems = [
    overdue.length
      ? `${tasksN(overdue.length)} متأخرة: ${list(overdue, (t) => `${t.title} (منذ ${arDays(-dayDiff(dueOf(t), today), true)})`)}.`
      : "",
    idle ? `${arCount(idle, "عضو واحد", "عضوان", "أعضاء", "عضوًا")} لم ينجزوا أي مهمة بعد.` : "",
  ]
    .filter(Boolean)
    .join(" ")

  return [
    `📣 ${team.group?.name ?? "الفريق"} (${range})`,
    `التقدم: ${progress}`,
    `الخطط: ${plans}`,
    `المشكلات: ${problems || "لا توجد عوائق حاليًا."}`,
  ].join("\n")
}

export function TeamPulse({
  team,
  meId,
  isAdmin,
  tasks,
  today,
  isCompleted,
}: {
  team: Team | null
  meId: number
  isAdmin: boolean
  tasks: Task[]
  today: string
  isCompleted: (t: Task) => boolean
}) {
  const [digest, setDigest] = useState<string | null>(null)
  if (!team?.group || team.members.length === 0) return null

  const members = [...team.members].sort((a, b) => b.done - a.done || a.name.localeCompare(b.name, "ar"))
  const topDone = members[0]?.done ?? 0
  const sumDone = members.reduce((a, m) => a + m.done, 0)
  const sumTotal = members.reduce((a, m) => a + m.total, 0)
  const pct = sumTotal ? Math.round((sumDone / sumTotal) * 100) : 0

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(digest ?? "")
      toast.success("تم نسخ الملخص")
    } catch {
      toast.error("تعذّر النسخ — حدد النص وانسخه يدويًا")
    }
  }
  const share = () => navigator.share?.({ text: digest ?? "" }).catch(() => {})

  return (
    <Card className={`${CARD} gap-0 py-0`}>
      <CardHeader className="py-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-light text-primary" aria-hidden>
          <Users className="size-5" />
        </div>
        <div className="min-w-0">
          <CardTitle>نبض الفريق</CardTitle>
          <CardDescription className="basis-auto">
            {team.group.name} · {arCount(members.length, "عضو واحد", "عضوان", "أعضاء", "عضوًا")} ·{" "}
            {arCount(team.tasks, "مهمة نشطة", "مهمتان نشطتان", "مهام نشطة", "مهمة نشطة")}
          </CardDescription>
        </div>
        <CardAction className="ms-auto">
          {isAdmin && (
            <Button
              variant="light"
              size="sm"
              className="min-h-10 cursor-pointer"
              onClick={() => setDigest(buildDigest(team, tasks, today, isCompleted))}
            >
              <FileText />
              ملخص الأسبوع
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold">إنجاز الفريق</span>
            <span className="tabular-nums text-muted-foreground">
              {sumDone} / {sumTotal} · {pct}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="نسبة إنجاز الفريق">
            <div className={`h-full rounded-full transition-[width] duration-300 ${pct === 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8" aria-label="إنجاز الأعضاء">
          {members.map((m) => {
            const me = m.id === meId
            const top = m.done > 0 && m.done === topDone
            return (
              <li
                key={m.id}
                className={`relative flex flex-col items-center gap-1.5 rounded-md border p-2.5 text-center transition-colors ${
                  me ? "border-primary bg-primary-light/40" : "border-border"
                }`}
              >
                {top && (
                  <span className="absolute top-1.5 end-1.5 text-warning" role="img" aria-label="الأعلى إنجازًا" title="الأعلى إنجازًا">
                    <Trophy className="size-3.5" />
                  </span>
                )}
                <ProgressRing done={m.done} total={m.total} size={56} />
                <span className="w-full truncate text-xs font-semibold" title={m.name}>
                  {me ? "أنت" : m.name}
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {m.done}/{m.total}
                </span>
                <span className="sr-only">{initials(m.name)}</span>
              </li>
            )
          })}
        </ul>
      </CardContent>

      <Dialog open={digest !== null} onOpenChange={(o) => !o && setDigest(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>ملخص الأسبوع (تقدم / خطط / مشكلات)</DialogTitle>
            <DialogDescription>نص جاهز للصق في مجموعة الفريق أو إرساله للإدارة. عدّله قبل النسخ إن لزم.</DialogDescription>
          </DialogHeader>
          <Textarea rows={9} value={digest ?? ""} onChange={(e) => setDigest(e.target.value)} aria-label="نص الملخص" className="text-sm leading-relaxed" />
          <DialogFooter>
            {typeof navigator.share === "function" && (
              <Button variant="light" className="min-h-10 cursor-pointer" onClick={share}>
                <Share2 />
                مشاركة
              </Button>
            )}
            <Button className="min-h-10 cursor-pointer" onClick={copy}>
              <Copy />
              نسخ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
