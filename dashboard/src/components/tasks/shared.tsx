// Shared types, labels and tiny helpers for the tasks feature (page + team/comments modules)
import { Check, ClipboardList, Heart, MessageCircle, Send, Share2, ThumbsUp, UserPlus, UsersRound } from "lucide-react"
import { cn } from "@/lib/utils"

export type Mine = { done: number; notes: string | null; actions_done?: string[] | string | null }
export type Subtask = { id: number; title: string; url: string | null; actions?: string[] | null; mine?: Mine }
export type Kind = "publish" | "create_account" | "interact" | "general"
export type Priority = "low" | "normal" | "high"
export type Task = {
  id: number
  group_id: number
  kind: Kind
  title: string
  description: string | null
  type_id: number | null
  post_count: number | null
  category: string | null
  priority: Priority
  due_date: string | null
  archived: number
  created_at: string
  created_by_name: string | null
  comment_count: number
  subtasks: Subtask[]
  progress: { done: number; total: number }
  done_ids: number[]
  mine?: Mine
}
export type Person = { id: number; name: string }
export type Member = Person & { done: number; total: number }
export type Team = { group: Person | null; tasks: number; members: Member[]; admins: Person[] }
export type Comment = {
  id: number
  task_id: number
  user_id: number | null
  body: string
  created_at: string
  user_name: string | null
  user_role: "super" | "admin" | "user" | null
}

export type Action = "react" | "comment" | "share_profile" | "share_group" | "follow"
export const ACTIONS: Record<Action, { label: string; Icon: typeof ThumbsUp }> = {
  react: { label: "إعجاب", Icon: ThumbsUp },
  comment: { label: "تعليق", Icon: MessageCircle },
  share_profile: { label: "مشاركة", Icon: Share2 },
  share_group: { label: "مشاركة في مجموعة", Icon: UsersRound },
  follow: { label: "متابعة", Icon: UserPlus },
}
export const ACTION_KEYS = Object.keys(ACTIONS) as Action[]

// actions_done may arrive as an array (parsed by the server) or a raw JSON string — accept both
export const actsOf = (v: unknown): string[] => {
  if (Array.isArray(v)) return v as string[]
  if (typeof v === "string" && v) {
    try {
      const p = JSON.parse(v)
      return Array.isArray(p) ? p : []
    } catch {
      return []
    }
  }
  return []
}

// one chip per required action: interactive toggle (onToggle given) or static read-only display
export function ActionChip({ action, on, onToggle }: { action: string; on: boolean; onToggle?: () => void }) {
  const a = ACTIONS[action as Action]
  if (!a) return null
  const { label, Icon } = a
  if (!onToggle)
    return (
      <span
        role="img"
        aria-label={`${label}: ${on ? "نعم" : "لا"}`}
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
          on ? "border-transparent bg-primary-light text-primary" : "border-border text-muted-foreground"
        }`}
      >
        {on && <Check className="size-3" aria-hidden />}
        <Icon className="size-3" aria-hidden />
        {label}
      </span>
    )
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={`focus-visible:ring-ring/50 inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition duration-150 outline-none focus-visible:ring-2 active:scale-95 ${
        on
          ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
          : "border-transparent bg-muted text-muted-foreground hover:bg-primary-light hover:text-primary"
      }`}
    >
      {on && <Check className="size-3.5" aria-hidden />}
      <Icon className="size-3.5" aria-hidden />
      {label}
    </button>
  )
}

// Metronic light badges (MASTER §3 mappings) + a kind icon tile for fast visual scanning
export const KINDS: Record<
  Kind,
  { label: string; variant: "primary-light" | "success" | "warning" | "info"; Icon: typeof Send; tint: string }
> = {
  publish: { label: "نشر", variant: "primary-light", Icon: Send, tint: "bg-primary-light text-primary" },
  create_account: { label: "إنشاء حساب", variant: "success", Icon: UserPlus, tint: "bg-success-light text-success" },
  interact: { label: "تفاعل", variant: "warning", Icon: Heart, tint: "bg-warning-light text-warning" },
  general: { label: "عام", variant: "info", Icon: ClipboardList, tint: "bg-info-light text-info" },
}

export const PRIORITIES: Record<Priority, { label: string; variant: "danger" | "primary-light" | "info" }> = {
  high: { label: "عالية", variant: "danger" },
  normal: { label: "عادية", variant: "primary-light" },
  low: { label: "منخفضة", variant: "info" },
}

export const ROLE_LABEL = { super: "مشرف عام", admin: "مدير مجموعة", user: "عضو" } as const

export const notify = () => window.dispatchEvent(new Event("ymc:refresh"))

// Arabic counted noun: 1 → one, 2 → two, 3–10 → "n few", 11+ → "n many"
export const arCount = (n: number, one: string, two: string, few: string, many: string) =>
  n === 1 ? one : n === 2 ? two : n >= 3 && n <= 10 ? `${n} ${few}` : `${n} ${many}`

// correct Arabic day count; genitive form after منذ/بعد (يومين instead of يومان)
export const arDays = (n: number, genitive = false) =>
  arCount(n, "يوم واحد", genitive ? "يومين" : "يومان", "أيام", "يوماً")

// whole days from today (local) to a YYYY-MM-DD due date; both parsed as UTC midnight
export const dayDiff = (due: string, today: string) => Math.round((Date.parse(due) - Date.parse(today)) / 86400000)

// server timestamps are SQLite UTC "YYYY-MM-DD HH:MM:SS" (no zone marker)
export const parseUtc = (s: string) => new Date(s.includes("T") || s.endsWith("Z") ? s : s.replace(" ", "T") + "Z")

// relative time in Arabic: الآن / منذ 5 دقائق / منذ ساعتين / منذ 3 أيام
export const ago = (iso: string, now = Date.now()) => {
  const m = Math.max(0, Math.round((now - parseUtc(iso).getTime()) / 60000))
  if (m < 1) return "الآن"
  if (m < 60) return `منذ ${arCount(m, "دقيقة", "دقيقتين", "دقائق", "دقيقة")}`
  const h = Math.round(m / 60)
  if (h < 24) return `منذ ${arCount(h, "ساعة", "ساعتين", "ساعات", "ساعة")}`
  return `منذ ${arDays(Math.round(h / 24), true)}`
}

// "22 أغسطس" with Latin digits (contract: Latin digits everywhere)
export const arDate = (ymd: string) =>
  new Date(ymd + "T00:00:00Z").toLocaleDateString("ar", { day: "numeric", month: "long", timeZone: "UTC", numberingSystem: "latn" })

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")

// Metronic card: 1px border, flat shadow (none in dark)
export const CARD = "rounded-[0.625rem] border-border shadow-[0_0_20px_0_rgba(76,87,125,.02)] dark:shadow-none"
// Metronic btn-icon btn-light: ≥40px, tint on hover
export const ICON_BTN = "text-muted-foreground hover:bg-primary-light hover:text-primary min-h-10 min-w-10 cursor-pointer rounded-md"

export function ProgressRing({ done, total, size = 40 }: { done: number; total: number; size?: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const c = 2 * Math.PI * 16
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`منجز ${done} من ${total}`}>
      <svg viewBox="0 0 40 40" className="size-full -rotate-90">
        <circle cx="20" cy="20" r="16" fill="none" strokeWidth="4" className="stroke-muted" />
        <circle
          cx="20"
          cy="20"
          r="16"
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          className={pct === 100 ? "stroke-success" : "stroke-primary"}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: "stroke-dashoffset 300ms ease" }}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center font-semibold tabular-nums"
        style={{ fontSize: size >= 56 ? 12 : 9 }}
        aria-hidden
      >
        {pct}%
      </span>
    </div>
  )
}

// Jira-style status categories; due-date urgency wins over progress for open tasks
export type Lane = "overdue" | "duesoon" | "todo" | "pending" | "done"
export const LANES: Record<Lane, { label: string; dot: string; variant: "danger" | "warning" | "secondary" | "primary-light" | "success" }> = {
  overdue: { label: "متأخرة", dot: "bg-destructive", variant: "danger" },
  duesoon: { label: "قريبة الاستحقاق", dot: "bg-warning-fill", variant: "warning" },
  todo: { label: "لم تبدأ", dot: "bg-muted-foreground", variant: "secondary" },
  pending: { label: "قيد التنفيذ", dot: "bg-primary", variant: "primary-light" },
  done: { label: "مكتملة", dot: "bg-success", variant: "success" },
}
export const LANE_KEYS = Object.keys(LANES) as Lane[]
export const laneOf = (complete: boolean, started: boolean, d: number | null): Lane =>
  complete ? "done" : d !== null && d < 0 ? "overdue" : d !== null && d <= 3 ? "duesoon" : started ? "pending" : "todo"

// assignee-style avatar stack: done members (success) before pending (muted); click opens detail when given
export function MemberStack({
  members,
  doneIds,
  meId,
  max = 6,
  onClick,
}: {
  members: Person[]
  doneIds: number[]
  meId?: number
  max?: number
  onClick?: () => void
}) {
  const done = new Set(doneIds)
  const sorted = [...members].sort((a, b) => Number(done.has(b.id)) - Number(done.has(a.id)))
  const shown = sorted.slice(0, max)
  const rest = sorted.length - shown.length
  const names = (ok: boolean) => sorted.filter((m) => done.has(m.id) === ok).map((m) => m.name).join("، ")
  const label = `أنجزها: ${names(true) || "لا أحد"} — لم ينجزها: ${names(false) || "لا أحد"}`
  const Tag = onClick ? "button" : "div"
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-label={label}
      title={onClick ? "عرض تفاصيل الإنجاز" : label}
      className={cn(
        "flex items-center -space-x-1.5 rounded-md py-0.5",
        onClick && "focus-visible:ring-ring/50 min-h-9 cursor-pointer px-1 outline-none hover:bg-muted focus-visible:ring-2",
      )}
    >
      {shown.map((m) => {
        const ok = done.has(m.id)
        return (
          <span
            key={m.id}
            aria-hidden
            className={cn(
              "flex size-7 items-center justify-center rounded-full text-[10px] font-bold ring-2 ring-card",
              ok ? "bg-success text-white" : "bg-secondary text-muted-foreground",
              m.id === meId && "outline-2 outline-offset-1 outline-primary",
            )}
          >
            {ok ? <Check className="size-3.5" strokeWidth={3} /> : initials(m.name)}
          </span>
        )
      })}
      {rest > 0 && (
        <span aria-hidden className="flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-2 ring-card">
          +{rest}
        </span>
      )}
    </Tag>
  )
}
