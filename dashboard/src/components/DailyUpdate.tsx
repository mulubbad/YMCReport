import { useEffect, useMemo, useRef, useState, type KeyboardEvent as KbEvent, type ReactElement } from "react"
import { CalendarCheck, Check, ChevronLeft, ChevronRight, CircleAlert, LoaderCircle, Minus, SkipForward, TrendingDown, TrendingUp, Zap } from "lucide-react"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

// ---------- types (CONTRACT.md → daily update wizard) ----------

type Status = "active" | "restricted" | "suspended" | "closed"

export type DailyTarget = {
  id: number; name: string; owner_name?: string; status: Status
  followers: number | null; posts_count: number | null; friend_requests: number | null
  groups_joined: number | null; group_shares: number | null
  yesterday_followers?: number | null; last_checked_at: string | null
  // the TYPE's window; optional because the single ⚡ path passes a row that may not carry it
  update_days?: number
}

type DeltaKey = "friend_requests" | "posts_count" | "group_shares" | "groups_joined"
type Metric = "followers" | DeltaKey
type Form = Record<Metric | "note", string> & { status: Status }
// what one target contributed to the run, kept for the closing summary
type Run = { name: string; skipped: boolean } & Record<Metric, number>

// ---------- constants & helpers ----------

const EMPTY: Form = { followers: "", friend_requests: "", posts_count: "", group_shares: "", groups_joined: "", note: "", status: "active" }

// ponytail: four words — mirrors STATUS in pages/Accounts.tsx rather than earning a shared export
const STATUS_AR: Record<Status, string> = { active: "نشط", restricted: "مقيّد", suspended: "موقوف", closed: "مغلق" }

const STEPS = [
  { title: "النمو", hint: "المتابعون وطلبات الصداقة" },
  { title: "النشاط", hint: "المنشورات والمشاركات والمجموعات" },
  { title: "المراجعة", hint: "الحالة والملاحظة وتأكيد ما سيُحفظ" },
]

const LABEL: Record<DeltaKey, string> = {
  friend_requests: "طلبات صداقة جديدة",
  posts_count: "منشورات جديدة",
  group_shares: "مشاركات في المجموعات",
  groups_joined: "مجموعات انضم إليها",
}
// followers is the only ABSOLUTE metric — it is the hero of step 0 and never gets +1/+5/+10 chips
const STEP_KEYS: Metric[][] = [["followers", "friend_requests"], ["posts_count", "group_shares", "groups_joined"], []]
const TOTALS: { key: Metric; label: string }[] = [
  { key: "followers", label: "متابعون جدد" },
  { key: "posts_count", label: "منشورات جديدة" },
  { key: "friend_requests", label: "طلبات صداقة" },
  { key: "groups_joined", label: "مجموعات جديدة" },
  { key: "group_shares", label: "مشاركات في المجموعات" },
]

const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"))
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n))
const num = (s: string) => (s.trim() === "" ? null : Number(s))
const ok = (n: number | null) => n != null && Number.isFinite(n)
const int = (s: string) => { const v = num(s); return ok(v) ? (v as number) : 0 }
const today = () => new Date().toLocaleDateString("en-CA")
const BAD = "قيمة غير صالحة — أدخل رقمًا صحيحًا 0 أو أكثر."

// ponytail: secondary text uses text-foreground/70, not text-muted-foreground — muted sits at 3.8:1
// on a light card, below the 4.5:1 floor this dialog is judged by. /70 clears it in both themes.
const DIM = "text-foreground/70"

// One labelled number box. `hero` is the step's headline metric; `delta` adds the quick-add chips.
function Field({ id, label, hint, value, hero, delta, error, onChange }: {
  id: string; label: string; hint: string; value: string
  hero?: boolean; delta?: boolean; error?: string
  onChange: (v: string) => void
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className={cn(hero && "justify-center")}>{label}</Label>
      <Input
        id={id} data-field type="number" min={0} inputMode="numeric" value={value}
        placeholder={delta ? "0" : undefined} aria-invalid={!!error} aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(e.target.value)}
        className={cn("tabular-nums placeholder:text-foreground/70", hero ? "h-12 text-center text-2xl font-semibold" : "h-11")}
      />
      {delta && (
        // one tap is the common case. The chips keep the house h-8 density; after:-inset-y-1.5 buys
        // back a 44px hit area without making the row look like three more buttons.
        <div className={cn("flex gap-1.5", hero && "justify-center")}>
          {[1, 5, 10].map((n) => (
            <Button
              key={n} type="button" variant="outline" size="sm" aria-label={`${label}: إضافة ${n}`}
              className="relative h-8 min-w-11 tabular-nums after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']"
              onClick={() => onChange(String(Math.max(0, int(value)) + n))}
            >
              +{n}
            </Button>
          ))}
        </div>
      )}
      <p id={`${id}-hint`} className={cn("text-xs", DIM, hero && "text-center")}>{hint}</p>
      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-destructive">
          <CircleAlert className="size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}

// Chained daily update: 3 steps per target, N targets per run. Replaces the old «تحديث سريع» grid.
export default function DailyUpdate({ open, targets, kind = "account", onOpenChange, onSaved }: {
  open: boolean
  targets: DailyTarget[]
  kind?: "account" | "page"
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}): ReactElement {
  const [idx, setIdx] = useState(0)
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<Form>(EMPTY)
  const [formId, setFormId] = useState(0)
  const [errs, setErrs] = useState<Partial<Record<Metric, string>>>({})
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [log, setLog] = useState<Run[]>([])
  const [done, setDone] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const savedAny = useRef(false)

  // `targets` empties in the same commit that closes the dialog, but Radix keeps the content mounted
  // for its 200ms exit — rendering the empty state there flashes a false «لا حسابات بانتظار
  // التحديث» on the way out. Hold the last real target for exactly that window.
  const lastT = useRef<DailyTarget | undefined>(undefined)
  const t = (targets[idx] ?? (open ? undefined : lastT.current)) as DailyTarget | undefined
  if (targets[idx]) lastT.current = targets[idx]
  const multi = targets.length > 1
  const noun = kind === "page" ? "صفحة" : "حساب"
  const nounPl = kind === "page" ? "صفحات" : "حسابات"
  const theOne = kind === "page" ? "الصفحة" : "الحساب"
  const wasUpdated = kind === "page" ? "حُدِّثت" : "حُدِّث"
  const draftKey = (id: number) => `ymc:daily:${kind}:${id}:${today()}`

  useEffect(() => {
    if (!open) return
    setIdx(0); setStep(0); setDone(false); setLog([]); setErrs({}); setSaveErr(null)
  }, [open])

  // draft restore — a half-typed run survives a refresh, but only for today. formId pins the form to
  // the target it was loaded for, so the save-effect below can never write it under the next target's key.
  useEffect(() => {
    if (!open || !t) return
    let draft: Partial<Form> = {}
    try { draft = JSON.parse(localStorage.getItem(draftKey(t.id)) ?? "{}") as Partial<Form> } catch { draft = {} }
    setForm({ ...EMPTY, status: t.status ?? "active", ...draft })
    setFormId(t.id)
  }, [open, t?.id])

  const dirty = useMemo(
    () => !!t && (form.note.trim() !== "" || form.status !== t.status || STEP_KEYS.flat().some((k) => form[k].trim() !== "")),
    [form, t],
  )

  useEffect(() => {
    if (!open || !t || done || formId !== t.id) return
    try {
      if (dirty) localStorage.setItem(draftKey(t.id), JSON.stringify(form))
      else localStorage.removeItem(draftKey(t.id))
    } catch { /* private mode or quota — the draft is a convenience, never the source of truth */ }
  }, [open, t?.id, formId, form, dirty, done])

  // the step's headline box takes focus so a keyboard-only run never needs the mouse
  useEffect(() => {
    if (!open || done) return
    bodyRef.current?.querySelector<HTMLInputElement>("input[data-field]")?.focus()
  }, [open, idx, step, done])

  const typedF = num(form.followers)
  // GET /accounts/daily supplies the previous daily snapshot. On the single ⚡ path there is none, and
  // the stored total IS the last reading — so the growth readout works there too. It is labelled
  // «آخر قراءة», not «أمس»: the previous snapshot may be several days old if a day was missed.
  const yF = t?.yesterday_followers ?? t?.followers ?? null
  const gain = yF != null && ok(typedF) ? (typedF as number) - yF : null
  const runPct = Math.round(((idx * 3 + step) / Math.max(1, targets.length * 3)) * 100)
  const savedCount = log.filter((r) => !r.skipped).length
  const skipped = log.length - savedCount
  const sum = (k: Metric) => log.reduce((s, r) => s + r[k], 0)

  const review = useMemo(() => {
    const out: { label: string; value: string }[] = []
    if (!t) return out
    if (ok(typedF)) out.push({ label: "المتابعون / الأصدقاء", value: gain == null ? fmt(typedF) : `${fmt(typedF)} (${signed(gain)})` })
    for (const k of ["posts_count", "friend_requests", "groups_joined", "group_shares"] as DeltaKey[]) {
      const v = num(form[k])
      if (ok(v)) out.push({ label: LABEL[k], value: `${signed(v as number)} · الإجمالي ${fmt((t[k] ?? 0) + (v as number))}` })
    }
    if (form.status !== t.status) out.push({ label: "الحالة الجديدة", value: STATUS_AR[form.status] })
    if (form.note.trim()) out.push({ label: "ملاحظة", value: form.note.trim() })
    return out
  }, [t, form, typedF, gain])

  const validate = () => {
    const next: Partial<Record<Metric, string>> = {}
    for (const k of STEP_KEYS[step] ?? []) {
      const v = num(form[k])
      if (v != null && (!Number.isFinite(v) || v < 0 || !Number.isInteger(v))) next[k] = BAD
    }
    setErrs(next)
    return Object.keys(next).length === 0
  }

  // followers goes up ABSOLUTE (it is what the platform shows); the four counters go up as `add_<k>`
  // deltas so the SERVER adds them to the live row. Computing the total here instead would post a
  // figure derived from `targets`, which was snapshotted when the run started — a sync landing
  // mid-run would then walk the counter backwards and record a negative day.
  const payload = () => {
    const b: Record<string, unknown> = {}
    if (ok(typedF)) b.followers = typedF
    for (const k of ["posts_count", "friend_requests", "groups_joined", "group_shares"] as DeltaKey[]) {
      const v = num(form[k])
      if (ok(v)) b[`add_${k}`] = v
    }
    if (t && form.status !== t.status) b.status = form.status
    if (form.note.trim()) b.note = form.note.trim()
    return b
  }

  const advance = (skip: boolean) => {
    setLog((l) => [...l, {
      name: t?.name ?? "", skipped: skip,
      followers: skip ? 0 : (gain ?? 0),
      friend_requests: skip ? 0 : int(form.friend_requests),
      posts_count: skip ? 0 : int(form.posts_count),
      group_shares: skip ? 0 : int(form.group_shares),
      groups_joined: skip ? 0 : int(form.groups_joined),
    }])
    setErrs({}); setSaveErr(null)
    if (idx + 1 < targets.length) { setIdx(idx + 1); setStep(0) } else setDone(true)
  }

  const save = async () => {
    if (!t || !validate()) return
    setSaving(true); setSaveErr(null)
    try {
      await api.post(`/${kind === "page" ? "pages" : "accounts"}/${t.id}/updates`, payload())
      try { localStorage.removeItem(draftKey(t.id)) } catch { /* see above */ }
      savedAny.current = true
      advance(false)
    } catch (e) {
      setSaveErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const next = () => {
    if (!validate()) return
    if (step < 2) setStep(step + 1)
    else void save()
  }

  const noNew = () => {
    // ponytail: followers is absolute — «لا جديد» re-affirms the stored total; a zero would wipe it.
    setForm((f) => (step === 0
      ? { ...f, followers: String(t?.followers ?? ""), friend_requests: "0" }
      : { ...f, posts_count: "0", group_shares: "0", groups_joined: "0" }))
    setErrs({}); setStep(step + 1)
  }

  const finish = () => {
    setConfirm(false)
    onOpenChange(false)
    if (savedAny.current) { savedAny.current = false; onSaved() }
  }
  const requestClose = (o: boolean) => { if (o) return; if (dirty && !done) setConfirm(true); else finish() }

  const saveLabel = saving ? "جارٍ الحفظ…"
    : step < 2 ? "التالي"
      : review.length === 0 ? "سجّل فحصًا بلا تغيير"
        : idx + 1 < targets.length ? "حفظ والتالي" : "حفظ وإنهاء"

  const onKeyDown = (e: KbEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.shiftKey || saving) return
    // Radix owns Enter inside the status Select; Shift+Enter in the note stays a newline (above)
    if ((e.target as HTMLElement).closest('[data-slot="select-trigger"]')) return
    e.preventDefault()
    // Enter walks this step's number boxes first, then falls through to التالي / the next account
    const list = Array.from(bodyRef.current?.querySelectorAll<HTMLInputElement>("input[data-field]") ?? [])
    const i = list.indexOf(e.target as HTMLInputElement)
    if (i >= 0 && i < list.length - 1) { list[i + 1].focus(); list[i + 1].select(); return }
    next()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        {/* onKeyDown sits here, not on the step body: that body is keyed per step, so moving to
            المراجعة (which has no number box) unmounts the focused element and Radix returns focus to
            this container — above any handler bound further in. */}
        <DialogContent className="sm:max-w-lg" onKeyDown={onKeyDown}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {done ? <CalendarCheck className="size-5 text-success" /> : <Zap className="size-5 text-primary" />}
              {done ? "اكتمل التحديث" : `التحديث الدوري — ${t?.name ?? ""}`}
            </DialogTitle>
            <DialogDescription>
              {done ? "هذه خلاصة ما سُجِّل في هذه الجولة."
                : t ? `${STEPS[step].hint}${t.owner_name ? ` · ${t.owner_name}` : ""}`
                  : "لا يوجد ما يُحدَّث الآن."}
            </DialogDescription>
          </DialogHeader>

          {done ? (
            <div className="grid gap-4">
              <div className="flex items-center gap-3 rounded-md border border-dashed p-3">
                <CalendarCheck className="size-6 shrink-0 text-success" />
                <div className="min-w-0">
                  <p className="font-semibold">
                    <span className="tabular-nums">{savedCount}</span> {noun} {wasUpdated}
                    {skipped > 0 && <> · <span className="tabular-nums">{skipped}</span> متخطّى</>}
                  </p>
                  <p className={cn("text-xs", DIM)}>سُجِّلت هذه القراءات ضمن تقرير التقدم اليومي.</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {TOTALS.map((x) => (
                  <div key={x.key} className="rounded-md border border-dashed p-2.5">
                    <p className={cn("text-xs", DIM)}>{x.label}</p>
                    <p className="mt-0.5 text-lg font-bold tabular-nums">{signed(sum(x.key))}</p>
                  </div>
                ))}
              </div>
              {skipped > 0 && (
                <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-destructive">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                  <span>بقي <span className="tabular-nums">{skipped}</span> {noun} بلا تحديث — أعد فتح «التحديث الدوري» لإكمالها.</span>
                </p>
              )}
              <div className="flex justify-end"><Button className="h-11 min-w-32" onClick={finish}><Check />تم</Button></div>
            </div>
          ) : !t ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center">
              <CalendarCheck className="size-6 text-success" />
              <p className="font-medium">لا {nounPl} بانتظار التحديث</p>
              <p className={cn("text-xs", DIM)}>كل {nounPl} المتتبَّعة في نطاقك ضمن دوريتها.</p>
              <Button className="mt-2 h-11" onClick={finish}>تم</Button>
            </div>
          ) : (
            <>
              {/* ---------- step rail + run progress ---------- */}
              <div className="grid gap-2.5 border-b pb-3">
                {multi && (
                  <>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium">{theOne} <span className="tabular-nums">{idx + 1}</span> من <span className="tabular-nums">{targets.length}</span></span>
                      <span className={cn("tabular-nums", DIM)}>{savedCount} محفوظ · {skipped} متخطّى</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar"
                      aria-label="تقدّم الجولة" aria-valuemin={0} aria-valuemax={100} aria-valuenow={runPct}>
                      <div className="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${runPct}%` }} />
                    </div>
                    <div className="flex flex-wrap gap-1" aria-hidden="true">
                      {targets.map((x, j) => {
                        const r = log[j]
                        return (
                          <span key={x.id} title={x.name}
                            className={cn("flex size-5 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums",
                              r && !r.skipped ? "bg-success-light" : r ? "bg-muted" : j === idx ? "bg-primary text-primary-foreground" : cn("border border-dashed", DIM))}>
                            {r ? (r.skipped ? <Minus className={cn("size-3", DIM)} /> : <Check className="size-3 text-success" />) : j + 1}
                          </span>
                        )
                      })}
                    </div>
                  </>
                )}
                <ol className="flex items-center gap-1.5" aria-label="خطوات التحديث">
                  {STEPS.map((s, i) => (
                    <li key={s.title} aria-current={i === step ? "step" : undefined} className={cn("flex items-center gap-1.5", i < 2 && "flex-1")}>
                      <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                        i < step ? "bg-success-light" : i === step ? "bg-primary text-primary-foreground" : cn("bg-muted", DIM))}>
                        {i < step ? <Check className="size-3.5 text-success" /> : i + 1}
                      </span>
                      <span className={cn("truncate text-xs", i === step ? "font-semibold" : DIM)}>{s.title}</span>
                      {i < 2 && <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-border" />}
                    </li>
                  ))}
                </ol>
                <p className={cn("text-xs", DIM)}>الخطوة <span className="tabular-nums">{step + 1}</span> من <span className="tabular-nums">3</span></p>
              </div>

              {/* ---------- the step itself ---------- */}
              <div ref={bodyRef} key={`${t.id}-${step}`}
                className="grid gap-4 duration-200 animate-in fade-in-0 slide-in-from-left-2 motion-reduce:animate-none">
                {step === 0 && (
                  <>
                    <Field
                      id="d-followers" label="المتابعون / الأصدقاء الآن" hero
                      hint={`المسجَّل حاليًا ${fmt(t.followers)} — اكتب الرقم كما يظهر في المنصة`}
                      value={form.followers} error={errs.followers}
                      onChange={(v) => setForm({ ...form, followers: v })}
                    />
                    <p className={cn("flex flex-wrap items-center justify-center gap-2", DIM)} aria-live="polite">
                      {yF == null ? (
                        <span>لا توجد قراءة سابقة — سيُعتمد رقم اليوم نقطةَ بداية</span>
                      ) : (
                        <>
                          <span>آخر قراءة <span className="font-medium tabular-nums text-foreground">{fmt(yF)}</span></span>
                          <span aria-hidden="true">·</span>
                          <span>جديد اليوم</span>
                          <span className={cn("inline-flex items-center gap-1 rounded-badge px-1.5 py-0.5 font-semibold tabular-nums text-foreground",
                            gain == null || gain === 0 ? "bg-muted" : gain > 0 ? "bg-success-light" : "bg-danger-light")}>
                            {gain != null && gain > 0 ? (
                              <TrendingUp className="size-3.5 text-success" />
                            ) : gain != null && gain < 0 ? (
                              <TrendingDown className="size-3.5 text-destructive" />
                            ) : (
                              <Minus className={cn("size-3.5", DIM)} />
                            )}
                            {gain == null ? "—" : signed(gain)}
                          </span>
                        </>
                      )}
                    </p>
                    <Field
                      id="d-friend_requests" label={LABEL.friend_requests} delta
                      hint={`الإجمالي المسجَّل ${fmt(t.friend_requests)} — اكتب الجديد منذ آخر فحص`}
                      value={form.friend_requests} error={errs.friend_requests}
                      onChange={(v) => setForm({ ...form, friend_requests: v })}
                    />
                  </>
                )}

                {step === 1 && (
                  <>
                    <Field
                      id="d-posts_count" label={LABEL.posts_count} hero delta
                      hint={`الإجمالي المسجَّل ${fmt(t.posts_count)} — اكتب الجديد منذ آخر فحص`}
                      value={form.posts_count} error={errs.posts_count}
                      onChange={(v) => setForm({ ...form, posts_count: v })}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      {(["group_shares", "groups_joined"] as DeltaKey[]).map((k) => (
                        <Field
                          key={k} id={`d-${k}`} label={LABEL[k]} delta
                          hint={`الإجمالي المسجَّل ${fmt(t[k])}`}
                          value={form[k]} error={errs[k]} onChange={(v) => setForm({ ...form, [k]: v })}
                        />
                      ))}
                    </div>
                  </>
                )}

                {step === 2 && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label htmlFor="d-status">حالة {theOne}</Label>
                        <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as Status })}>
                          <SelectTrigger id="d-status" className="w-full data-[size=default]:h-11">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(STATUS_AR) as Status[]).map((k) => (
                              <SelectItem key={k} value={k}>{STATUS_AR[k]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="d-note">ملاحظة (اختياري)</Label>
                        <Textarea id="d-note" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                      </div>
                    </div>
                    <div className="grid gap-1.5 rounded-md border border-dashed p-3">
                      <p className="text-xs font-semibold">ما سيُحفظ الآن</p>
                      {review.length === 0 ? (
                        <p className={cn("text-xs", DIM)}>لا تغييرات — سيُسجَّل فحص اليوم فقط حتى لا يظهر متأخرًا في تقرير الالتزام.</p>
                      ) : (
                        review.map((r) => (
                          <div key={r.label} className="flex items-start justify-between gap-3">
                            <span className={DIM}>{r.label}</span>
                            <span className="min-w-0 text-end font-medium tabular-nums">{r.value}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* ---------- controls ---------- */}
              <div className="grid gap-2">
                {saveErr && (
                  <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-destructive">
                    <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span>تعذّر الحفظ: {saveErr} — تحقق من الاتصال ثم اضغط «حفظ» مجددًا.</span>
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" className="h-11" disabled={step === 0 || saving} onClick={() => { setErrs({}); setStep(step - 1) }}>
                    <ChevronRight />
                    رجوع
                  </Button>
                  {/* secondary, not `light`: primary-on-primary-light drops to 3.6:1 in dark mode */}
                  {step < 2 && (
                    <Button type="button" variant="secondary" className="h-11" disabled={saving} onClick={noNew}>
                      <Minus />
                      لا جديد
                    </Button>
                  )}
                  {multi && (
                    <Button type="button" variant="ghost" className="h-11" disabled={saving} onClick={() => advance(true)}>
                      <SkipForward />
                      تخطّي
                    </Button>
                  )}
                  <Button type="button" className="ms-auto h-11 min-w-32" disabled={saving} onClick={next}>
                    {saving ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : step === 2 && <Check />}
                    {saveLabel}
                    {step < 2 && !saving && <ChevronLeft />}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تجاهل ما أدخلته؟</AlertDialogTitle>
            <AlertDialogDescription>
              أدخلت أرقامًا لم تُحفظ بعد. الإغلاق الآن يتركها بلا حفظ — تبقى مسودة على هذا الجهاز حتى نهاية اليوم فقط.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">متابعة الإدخال</AlertDialogCancel>
            <AlertDialogAction variant="destructive" className="h-11" onClick={finish}>تجاهل وإغلاق</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
