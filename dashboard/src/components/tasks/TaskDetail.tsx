// Full task detail popup (Jira issue-view style) + the member interaction primitives it shares with the card
import { useState } from "react"
import { toast } from "sonner"
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  BellRing,
  CalendarDays,
  Check,
  Clock,
  ExternalLink,
  Flame,
  MessageCircle,
  MessageSquare,
  Pencil,
  Repeat,
  Send,
  Trash2,
  Users,
  X,
} from "lucide-react"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ActionChip,
  KINDS,
  LANES,
  MemberStack,
  PRIORITIES,
  actsOf,
  ago,
  arCount,
  arDate,
  arDays,
  dayDiff,
  initials,
  laneOf,
  notify,
  parseUtc,
  type Member,
  type Mine,
  type Person,
  type Subtask,
  type Task,
} from "./shared"

// local state is source of truth after mount; saves upsert own interaction row.
// required non-empty → action mode: body carries actions_done (never done) and the
// server derives done (= actions_done covers all required); we mirror it from the response.
export function useMine(
  taskId: number,
  mine: Mine | undefined,
  subtaskId?: number,
  required?: string[],
  onDone?: (d: boolean) => void,
) {
  const actionMode = !!required?.length
  const [done, setDone] = useState(!!mine?.done)
  const [acts, setActs] = useState<string[]>(() => actsOf(mine?.actions_done))
  const [notes, setNotes] = useState(mine?.notes ?? "")
  const [saved, setSaved] = useState(mine?.notes ?? "")

  const save = async (d: boolean, a: string[], n: string) => {
    try {
      const row = await api.put(
        `/tasks/${taskId}/interactions`,
        actionMode
          ? { subtask_id: subtaskId, actions_done: a, notes: n || null }
          : { subtask_id: subtaskId ?? null, done: d ? 1 : 0, notes: n || null },
      )
      if (actionMode) {
        const sd = !!row.done // server-derived, not computed locally
        toast.success(sd && !done ? "أنجزت جميع الإجراءات" : "تم الحفظ")
        setDone(sd)
        onDone?.(sd)
      } else {
        toast.success("تم الحفظ")
      }
      setSaved(n)
      notify()
    } catch (e) {
      if (actionMode) setActs(acts) // revert optimistic chip on failure
      toast.error((e as Error).message)
    }
  }

  return {
    done,
    acts,
    notes,
    setNotes,
    toggle: (v: boolean) => {
      setDone(v)
      void save(v, acts, notes)
    },
    toggleAct: (a: string) => {
      const next = acts.includes(a) ? acts.filter((x) => x !== a) : [...acts, a]
      setActs(next)
      void save(done, next, notes)
    },
    blur: () => {
      if (notes !== saved) void save(done, acts, notes) // notes save carries current acts — nothing lost
    },
  }
}

// scale feedback on toggle (~150ms press animation)
export const CHECK_CLS = "cursor-pointer transition-transform duration-150 active:scale-90"

export function SubtaskRow({ taskId, sub, onToggle }: { taskId: number; sub: Subtask; onToggle?: (v: boolean) => void }) {
  const required = sub.actions ?? []
  const m = useMine(taskId, sub.mine, sub.id, required, onToggle)
  const link = sub.url && (
    <a
      href={sub.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`فتح رابط ${sub.title}`}
      title={sub.url}
      className="text-muted-foreground hover:bg-primary-light hover:text-primary focus-visible:ring-ring/50 inline-flex size-9 shrink-0 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2"
    >
      <ExternalLink className="size-4" />
    </a>
  )
  // mobile: full-width row under the title/chips; desktop: inline at the end
  const notes = (
    <Input
      className="h-8 w-full text-xs sm:ms-auto sm:w-44"
      placeholder="ملاحظات"
      value={m.notes}
      onChange={(e) => m.setNotes(e.target.value)}
      onBlur={m.blur}
    />
  )
  // actioned subtask: chips replace the manual checkbox; done is server-derived
  if (required.length > 0)
    return (
      <div className="space-y-1 py-2">
        <div className="flex min-h-8 items-center gap-1.5">
          {m.done && <Check className="animate-in zoom-in text-success size-4 shrink-0 duration-300" aria-label="منجزة" />}
          <span title={sub.title} className={cn("min-w-0 flex-1 truncate text-sm transition-colors duration-150", m.done && "text-muted-foreground")}>
            {sub.title}
          </span>
          {link}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`إجراءات ${sub.title}`}>
            {required.map((a) => (
              <ActionChip key={a} action={a} on={m.acts.includes(a)} onToggle={() => m.toggleAct(a)} />
            ))}
          </div>
          {notes}
        </div>
      </div>
    )
  return (
    <div className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {/* whole title row is the toggle target (wide touch area despite compact height) */}
        <label className="flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 py-0.5">
          <Checkbox
            className={CHECK_CLS}
            checked={m.done}
            onCheckedChange={(v) => {
              m.toggle(v === true)
              onToggle?.(v === true)
            }}
          />
          <span title={sub.title} className={cn("min-w-0 flex-1 truncate text-sm transition-colors duration-150", m.done && "text-muted-foreground")}>
            {sub.title}
          </span>
        </label>
        {link}
      </div>
      {notes}
    </div>
  )
}

// read-only checklist line (archived tasks, responses dialog)
export function DoneText({ mine, label, actions, url }: { mine?: Mine; label?: string; actions?: string[] | null; url?: string | null }) {
  const acts = actsOf(mine?.actions_done)
  return (
    <div className="space-y-1 py-1.5">
      <div className="flex items-start gap-2 text-sm">
        {mine?.done ? (
          <Check className="text-success mt-0.5 size-4 shrink-0" aria-label="منجز" />
        ) : (
          <X className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-label="غير منجز" />
        )}
        <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">
          {label ?? (mine?.done ? "منجز" : "غير منجز")}
          {mine?.notes && <span className="text-muted-foreground"> — {mine.notes}</span>}
        </span>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" aria-label={`فتح رابط ${label}`} className="text-muted-foreground hover:text-primary">
            <ExternalLink className="size-4" />
          </a>
        )}
      </div>
      {!!actions?.length && (
        <div className="flex flex-wrap gap-1 ps-6">
          {actions.map((a) => (
            <ActionChip key={a} action={a} on={acts.includes(a)} />
          ))}
        </div>
      )}
    </div>
  )
}

// compact due chip (open tasks only — the status badge covers completed ones)
export function dueChip(d: number, due: string) {
  if (d < 0) return { cls: "bg-danger-light text-destructive", Icon: AlertTriangle, text: `متأخرة ${arDays(-d, true)}` }
  if (d === 0) return { cls: "bg-warning-light text-warning", Icon: Clock, text: "تستحق اليوم" }
  if (d <= 3) return { cls: "bg-warning-light text-warning", Icon: Clock, text: `بعد ${arDays(d, true)}` }
  return { cls: "bg-muted text-muted-foreground", Icon: CalendarDays, text: due }
}

type DetailProps = {
  task: Task | null
  ro: boolean
  isAdmin: boolean
  meId: number
  today: string
  typeName: (id: number | null) => string | undefined
  members: Member[]
  admins: Person[]
  onClose: () => void
  onComments: (t: Task) => void
  onResponses: (t: Task) => void
  onEdit: (t: Task) => void
  onArchive: (t: Task, archived: 0 | 1) => void
  onDelete: (t: Task) => void
}

export function TaskDetailDialog(props: DetailProps) {
  const { task, onClose } = props
  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 p-0 sm:max-w-2xl">
        {/* keyed body: interaction state resets per task, survives list refreshes of the same task */}
        {task && <DetailBody key={task.id} {...props} task={task} />}
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-end font-medium break-words">{children}</dd>
    </div>
  )
}

// private message composer: recipient fixed (admin → member) or chosen from the group (member → admin/peer)
function MessageDialog({
  task,
  to,
  choices,
  onClose,
}: {
  task: Task
  to: Person | null
  choices: Person[]
  onClose: () => void
}) {
  const [recipient, setRecipient] = useState<string>(to ? String(to.id) : choices[0] ? String(choices[0].id) : "")
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)
  const name = to?.name ?? choices.find((p) => String(p.id) === recipient)?.name ?? ""

  const send = async () => {
    if (!body.trim() || !recipient) return
    setSending(true)
    try {
      await api.post(`/tasks/${task.id}/message`, { user_id: Number(recipient), body: body.trim() })
      toast.success(`أُرسلت الرسالة الخاصة إلى ${name}`)
      notify()
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="size-4 text-info" aria-hidden />
            رسالة خاصة
          </DialogTitle>
          <DialogDescription className="break-words">
            بخصوص «{task.title}» — تصل كإشعار خاص للمستلم فقط، ويمكنه الرد من نفس النافذة.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="msg-to">إلى</Label>
            {to ? (
              <div id="msg-to" className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary-light text-[10px] font-bold text-primary" aria-hidden>
                  {initials(to.name)}
                </span>
                {to.name}
              </div>
            ) : (
              <Select value={recipient} onValueChange={setRecipient}>
                <SelectTrigger id="msg-to" className="w-full">
                  <SelectValue placeholder="اختر المستلم" />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="msg-body">الرسالة</Label>
            <Textarea
              id="msg-body"
              rows={4}
              maxLength={1000}
              autoFocus
              placeholder="اكتب رسالة قصيرة وواضحة: ما المطلوب، ومتى."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            <p className="text-end text-[11px] tabular-nums text-muted-foreground" aria-hidden>
              {body.length}/1000
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="light" className="min-h-10 cursor-pointer" onClick={onClose}>
            إلغاء
          </Button>
          <Button className="min-h-10 cursor-pointer" disabled={sending || !body.trim() || !recipient} onClick={send}>
            <Send />
            إرسال
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DetailBody({
  task: t,
  ro,
  isAdmin,
  meId,
  today,
  typeName,
  members,
  admins,
  onClose,
  onComments,
  onResponses,
  onEdit,
  onArchive,
  onDelete,
}: DetailProps & { task: Task }) {
  const mine = useMine(t.id, t.mine)
  const [subDone, setSubDone] = useState<Record<number, boolean>>(() => Object.fromEntries(t.subtasks.map((s) => [s.id, !!s.mine?.done])))
  const [msg, setMsg] = useState<{ to: Person | null } | null>(null)
  const [nudging, setNudging] = useState<number | "all" | null>(null)
  const hasSubs = t.subtasks.length > 0
  const myCount = t.subtasks.filter((s) => subDone[s.id] ?? !!s.mine?.done).length
  const complete = isAdmin ? t.progress.total > 0 && t.progress.done === t.progress.total : hasSubs ? myCount === t.subtasks.length : mine.done
  const started = isAdmin ? t.progress.done > 0 : hasSubs ? myCount > 0 : mine.done
  const due = t.due_date?.slice(0, 10) ?? null
  const d = due ? dayDiff(due, today) : null
  const lane = laneOf(complete, started, d)
  const chip = due && !complete ? dueChip(d!, due) : null
  const kind = KINDS[t.kind]
  const daily = t.repeat === "daily"
  const dailyOff = daily && !t.repeat_active
  const offReason = !dailyOff ? "" : t.repeat_from && t.repeat_from.slice(0, 10) > today ? ` — تبدأ في ${t.repeat_from.slice(0, 10)}` : t.repeat_until ? ` — انتهت في ${t.repeat_until.slice(0, 10)}` : ""
  const done = new Set(t.done_ids)
  const roster = [...members].sort((a, b) => Number(done.has(b.id)) - Number(done.has(a.id)) || a.name.localeCompare(b.name, "ar"))
  const pendingCount = roster.filter((m) => !done.has(m.id)).length
  const pct = t.progress.total ? Math.round((t.progress.done / t.progress.total) * 100) : 0
  const createdYmd = parseUtc(t.created_at).toISOString().slice(0, 10)
  // who a member can message: admins first, then teammates (never self)
  const choices: Person[] = [...admins, ...members].filter((p) => p.id !== meId)

  const nudge = async (target: Member | "all") => {
    setNudging(target === "all" ? "all" : target.id)
    try {
      const r = await api.post(`/tasks/${t.id}/nudge`, target === "all" ? {} : { user_ids: [target.id] })
      if (r.notified === 0) toast.info(target === "all" ? "تم تذكيرهم اليوم بالفعل" : `تم تذكير ${target.name} اليوم بالفعل`)
      else
        toast.success(
          target === "all"
            ? `أُرسل التذكير إلى ${arCount(r.notified, "عضو واحد", "عضوين", "أعضاء", "عضوًا")}${r.skipped ? `، و${r.skipped} ذُكّروا اليوم` : ""}`
            : `أُرسل التذكير إلى ${target.name}`,
        )
      notify()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setNudging(null)
    }
  }

  return (
    <>
      <DialogHeader className="border-b px-5 py-4 pe-12 text-start">
        <div className="flex items-start gap-3">
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-md", kind.tint)} aria-hidden>
            <kind.Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className={cn("text-base leading-snug break-words", complete && "text-muted-foreground")}>{t.title}</DialogTitle>
            <DialogDescription className="mt-0.5 text-xs">
              {kind.label}
              {t.category && ` · ${t.category}`}
              {t.created_by_name && ` · أضافها ${t.created_by_name} · ${ago(t.created_at)}`}
            </DialogDescription>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <Badge variant={LANES[lane].variant}>{LANES[lane].label}</Badge>
          <Badge variant={(PRIORITIES[t.priority] ?? PRIORITIES.normal).variant}>{(PRIORITIES[t.priority] ?? PRIORITIES.normal).label}</Badge>
          {daily && (
            <span className={cn("inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-xs font-semibold", dailyOff ? "bg-muted text-muted-foreground" : "bg-info-light text-info")}>
              <Repeat className="size-3" aria-hidden />
              {dailyOff ? "غير نشطة" : "تتجدد يوميًا"}
            </span>
          )}
          {chip && (
            <span className={cn("inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-xs font-semibold", chip.cls)}>
              <chip.Icon className="size-3" aria-hidden />
              {chip.text}
            </span>
          )}
          <Button variant="light" size="sm" className="ms-auto min-h-9 cursor-pointer" onClick={() => onComments(t)}>
            <MessageSquare />
            نقاش
            {t.comment_count > 0 && <span className="tabular-nums">({t.comment_count})</span>}
          </Button>
        </div>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_240px]">
          <div className="min-w-0 space-y-5">
            <section>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">الوصف</h3>
              {t.description ? (
                <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{t.description}</p>
              ) : (
                <p className="text-sm text-muted-foreground">لا يوجد وصف.</p>
              )}
            </section>

            {hasSubs && (
              <section>
                <h3 className="mb-1.5 flex items-center justify-between text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  قائمة التنفيذ
                  {!isAdmin && (
                    <span className="tabular-nums normal-case">
                      {myCount}/{t.subtasks.length}
                    </span>
                  )}
                </h3>
                <div className="divide-y divide-dashed rounded-md border px-3">
                  {isAdmin
                    ? t.subtasks.map((s) => (
                        <div key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                          <span className="min-w-0 flex-[1_1_10rem] break-words">{s.title}</span>
                          {!!s.actions?.length && (
                            <span className="flex flex-wrap gap-1">
                              {s.actions.map((a) => (
                                <ActionChip key={a} action={a} on={false} />
                              ))}
                            </span>
                          )}
                          {s.url && (
                            <a href={s.url} target="_blank" rel="noreferrer" aria-label={`فتح رابط ${s.title}`} className="text-muted-foreground hover:text-primary">
                              <ExternalLink className="size-4" />
                            </a>
                          )}
                        </div>
                      ))
                    : ro || dailyOff
                      ? t.subtasks.map((s) => <DoneText key={s.id} mine={s.mine} label={s.title} actions={s.actions} url={s.url} />)
                      : t.subtasks.map((s) => (
                          <SubtaskRow key={s.id} taskId={t.id} sub={s} onToggle={(v) => setSubDone((m) => ({ ...m, [s.id]: v }))} />
                        ))}
                </div>
              </section>
            )}

            {!isAdmin && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{daily ? "حالتي اليوم" : "حالتي"}</h3>
                {dailyOff && <p className="text-xs text-muted-foreground">المهمة اليومية غير نشطة حاليًا{offReason}.</p>}
                {daily && t.my_streak > 0 && (
                  <p className="flex items-center gap-1 text-xs font-semibold text-warning">
                    <Flame className="size-3.5" aria-hidden />
                    مواظب منذ {arDays(t.my_streak)}
                  </p>
                )}
                {ro || dailyOff ? (
                  !hasSubs && <DoneText mine={t.mine} />
                ) : (
                  <>
                    {!hasSubs && (
                      <label className="flex min-h-10 w-fit cursor-pointer items-center gap-2 text-sm font-semibold">
                        <Checkbox className={CHECK_CLS} checked={mine.done} onCheckedChange={(v) => mine.toggle(v === true)} />
                        {mine.done ? <span className="text-success">{daily ? "أنجزتها اليوم" : "أنجزتها"}</span> : daily ? "أنجزتها اليوم؟" : "أنجزتها؟"}
                      </label>
                    )}
                    <Textarea
                      rows={2}
                      className="text-sm"
                      placeholder="ملاحظاتي على هذه المهمة"
                      aria-label="ملاحظاتي"
                      value={mine.notes}
                      onChange={(e) => mine.setNotes(e.target.value)}
                      onBlur={mine.blur}
                    />
                  </>
                )}
                {ro && t.mine?.notes && hasSubs && <p className="text-sm text-muted-foreground">ملاحظتي: {t.mine.notes}</p>}
                {choices.length > 0 && (
                  <Button variant="light" size="sm" className="min-h-10 cursor-pointer" onClick={() => setMsg({ to: null })}>
                    <MessageCircle />
                    رسالة خاصة
                  </Button>
                )}
              </section>
            )}
          </div>

          <aside className="space-y-4 sm:border-s sm:ps-5">
            <dl className="divide-y divide-dashed">
              <Field label="الحالة">
                <Badge variant={LANES[lane].variant}>{LANES[lane].label}</Badge>
              </Field>
              <Field label="الأولوية">{(PRIORITIES[t.priority] ?? PRIORITIES.normal).label}</Field>
              {daily ? (
                <>
                  <Field label="التكرار">يوميًا</Field>
                  {t.repeat_from && <Field label="من">{t.repeat_from.slice(0, 10)}</Field>}
                  <Field label="حتى">{t.repeat_until ? t.repeat_until.slice(0, 10) : "دائمة"}</Field>
                </>
              ) : (
                <Field label="الاستحقاق">{due ? new Date(due + "T00:00:00Z").toLocaleDateString("ar", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC", numberingSystem: "latn" }) : "—"}</Field>
              )}
              {t.type_id && <Field label="النوع المستهدف">{typeName(t.type_id) ?? "—"}</Field>}
              {t.post_count && <Field label="عدد المنشورات">{t.post_count}</Field>}
              {t.category && <Field label="الفئة">{t.category}</Field>}
              <Field label="تاريخ الإضافة">
                <time dateTime={t.created_at}>{arDate(createdYmd)}</time>
              </Field>
            </dl>

            {isAdmin && (
            <section>
              <h3 className="mb-2 flex items-center justify-between text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {daily ? "إنجاز الفريق اليوم" : "إنجاز الفريق"}
                <span className="tabular-nums normal-case">
                  {t.progress.done}/{t.progress.total} · {pct}%
                </span>
              </h3>
              <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="نسبة إنجاز الفريق">
                <div className={cn("h-full rounded-full transition-[width] duration-300", pct === 100 ? "bg-success" : "bg-primary")} style={{ width: `${pct}%` }} />
              </div>
              {isAdmin && !ro && pendingCount > 0 && (
                <Button
                  variant="light"
                  size="sm"
                  className="mb-2 min-h-10 w-full cursor-pointer"
                  disabled={nudging !== null}
                  onClick={() => nudge("all")}
                >
                  <BellRing />
                  تنبيه من لم ينجز ({pendingCount})
                </Button>
              )}
              {roster.length > 0 ? (
                <ul className="space-y-0.5" aria-label="حالة الأعضاء">
                  {roster.map((m) => {
                    const ok = done.has(m.id)
                    return (
                      <li key={m.id} className={cn("rounded-md px-1 py-1.5 text-sm", m.id === meId && "bg-primary-light/40")}>
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                              ok ? "bg-success text-white" : "bg-secondary text-muted-foreground",
                            )}
                            aria-hidden
                          >
                            {ok ? <Check className="size-3.5" strokeWidth={3} /> : initials(m.name)}
                          </span>
                          <span className="min-w-0 flex-1 truncate" title={m.name}>
                            {m.id === meId ? "أنت" : m.name}
                          </span>
                          <span className={cn("shrink-0 text-[11px] font-semibold", ok ? "text-success" : "text-muted-foreground")}>{ok ? "منجز" : "لم ينجز"}</span>
                        </div>
                        {/* labelled actions on their own line — icon-only buttons were easy to miss */}
                        {isAdmin && (
                          <div className="mt-1 flex gap-1 ps-9">
                            {!ok && !ro && (
                              <Button
                                variant="light"
                                size="sm"
                                className="h-8 cursor-pointer bg-warning-light text-warning hover:bg-warning-fill hover:text-neutral-900"
                                aria-label={`تنبيه ${m.name}`}
                                disabled={nudging !== null}
                                onClick={() => nudge(m)}
                              >
                                <BellRing />
                                تنبيه
                              </Button>
                            )}
                            <Button
                              variant="light"
                              size="sm"
                              className="h-8 cursor-pointer bg-info-light text-info hover:bg-info hover:text-white"
                              aria-label={`رسالة خاصة إلى ${m.name}`}
                              onClick={() => setMsg({ to: m })}
                            >
                              <MessageCircle />
                              رسالة
                            </Button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <MemberStack members={members} doneIds={t.done_ids} />
              )}
            </section>
            )}
          </aside>
        </div>
      </div>

      {isAdmin && (
        <DialogFooter className="flex-row flex-wrap justify-end gap-1.5 border-t px-5 py-3">
          <Button variant="light" size="sm" className="min-h-10 cursor-pointer" onClick={() => onResponses(t)}>
            <Users />
            تفاصيل الإنجاز
          </Button>
          {!ro && (
            <Button variant="light" size="sm" className="min-h-10 cursor-pointer" onClick={() => onEdit(t)}>
              <Pencil />
              تعديل
            </Button>
          )}
          <Button variant="light" size="sm" className="min-h-10 cursor-pointer" onClick={() => onArchive(t, ro ? 0 : 1)}>
            {ro ? <ArchiveRestore /> : <Archive />}
            {ro ? "استعادة" : "أرشفة"}
          </Button>
          <Button variant="ghost" size="sm" className="min-h-10 cursor-pointer text-destructive hover:bg-danger-light hover:text-destructive" onClick={() => onDelete(t)}>
            <Trash2 />
            حذف
          </Button>
          <Button variant="ghost" size="sm" className="min-h-10 cursor-pointer sm:hidden" onClick={onClose}>
            إغلاق
          </Button>
        </DialogFooter>
      )}

      {msg && <MessageDialog task={t} to={msg.to} choices={choices} onClose={() => setMsg(null)} />}
    </>
  )
}
