import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  Check,
  ClipboardList,
  Kanban,
  LayoutGrid,
  MessageSquare,
  Repeat,
  Flame,
  Maximize2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useScope } from "@/lib/scope"
import { TaskDailyDialog } from "@/components/TaskDailyDialog"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ACTION_KEYS,
  ActionChip,
  CARD,
  ICON_BTN,
  KINDS,
  LANES,
  LANE_KEYS,
  MemberStack,
  PRIORITIES,
  ProgressRing,
  ago,
  dayDiff,
  initials,
  laneOf,
  notify,
  type Action,
  type Kind,
  type Lane,
  type Member,
  type Priority,
  type Task,
  type Team,
} from "@/components/tasks/shared"
import { CommentsDialog } from "@/components/tasks/Comments"
import { TeamPulse } from "@/components/tasks/TeamPulse"
import { CHECK_CLS, DoneText, TaskDetailDialog, dueChip, useMine } from "@/components/tasks/TaskDetail"

type AccountType = { id: number; name: string; group_id: number }
type IRow = {
  user_id: number
  user_name: string
  subtask_id: number | null
  subtask_title: string | null
  done: number
  notes: string | null
  actions_done?: string[] | string | null
}

const EDGE: Record<Lane, string> = {
  overdue: "border-s-destructive",
  duesoon: "border-s-warning-fill",
  todo: "border-s-border",
  pending: "border-s-primary",
  done: "border-s-success",
}

function TaskCard({
  t,
  ro,
  isAdmin,
  today,
  members,
  onOpen,
  onResponses,
  onComments,
  onEdit,
  onArchive,
  onDelete,
  onDaily,
}: {
  t: Task
  ro: boolean
  isAdmin: boolean
  today: string
  members: Member[]
  onOpen: (t: Task) => void
  onResponses: (t: Task) => void
  onComments: (t: Task) => void
  onEdit: (t: Task) => void
  onArchive: (t: Task, archived: 0 | 1) => void
  onDelete: (t: Task) => void
  onDaily: (t: Task) => void
}) {
  // quick toggle for tasks without subtasks; subtask work happens in the detail popup
  // (cards remount when the popup closes, so server state is picked up — see `ver` in Tasks)
  const mine = useMine(t.id, t.mine)
  const hasSubs = t.subtasks.length > 0
  const myCount = t.subtasks.filter((s) => !!s.mine?.done).length
  const complete = isAdmin ? t.progress.total > 0 && t.progress.done === t.progress.total : hasSubs ? myCount === t.subtasks.length : mine.done
  const started = isAdmin ? t.progress.done > 0 : hasSubs ? myCount > 0 : mine.done

  const due = t.due_date?.slice(0, 10) ?? null
  const d = due ? dayDiff(due, today) : null
  const lane = laneOf(complete, started, d)
  const chip = due && !complete ? dueChip(d!, due) : null
  const kind = KINDS[t.kind]
  const daily = t.repeat === "daily"
  const dailyOff = daily && !t.repeat_active

  return (
    <Card className={cn(CARD, "gap-0 border-s-4 py-0 transition-colors duration-200", EDGE[lane], ro && "bg-muted/30 opacity-75")}>
      {/* header: kind tile · title (opens details) + status · meta line · open button */}
      <div className="flex items-start gap-2.5 px-3 pt-3 pb-2 sm:px-4">
        <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md", kind.tint)} title={kind.label} aria-hidden>
          <kind.Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={() => onOpen(t)}
              className={cn(
                // basis keeps the title readable in narrow board lanes: the status badge wraps under it instead of squeezing it
                "focus-visible:ring-ring/50 min-w-0 flex-[1_1_9rem] cursor-pointer rounded-sm text-start text-sm leading-snug font-semibold break-words outline-none hover:text-primary focus-visible:ring-2",
                complete && "text-muted-foreground",
              )}
            >
              {t.title}
            </button>
            <Badge variant={LANES[lane].variant} className="shrink-0">
              {LANES[lane].label}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span>{kind.label}</span>
            {t.category && <span className="max-w-32 truncate">· {t.category}</span>}
            {t.priority === "high" && (
              <Badge variant="danger" className="px-1.5 py-0 text-[10px]">
                عالية
              </Badge>
            )}
            {t.priority === "low" && <span>· {PRIORITIES.low.label}</span>}
            {daily && (
              <span className={cn("inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-semibold", dailyOff ? "bg-muted text-muted-foreground" : "bg-info-light text-info")}>
                <Repeat className="size-3" aria-hidden />
                {dailyOff
                  ? t.repeat_from && t.repeat_from.slice(0, 10) > today
                    ? `تبدأ ${t.repeat_from.slice(0, 10)}`
                    : "انتهت"
                  : t.repeat_until
                    ? `يومية حتى ${t.repeat_until.slice(0, 10)}`
                    : "يومية"}
              </span>
            )}
            {daily && !isAdmin && t.my_streak >= 2 && (
              <span className="inline-flex items-center gap-0.5 font-semibold text-warning" title="أيام إنجاز متتالية">
                <Flame className="size-3" aria-hidden />
                {t.my_streak}
              </span>
            )}
            {chip && (
              <span className={cn("inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-semibold", chip.cls)}>
                <chip.Icon className="size-3" aria-hidden />
                {chip.text}
              </span>
            )}
            {t.created_by_name && (
              <span className="truncate">
                · {t.created_by_name} · <time dateTime={t.created_at}>{ago(t.created_at)}</time>
              </span>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon-lg" className={cn(ICON_BTN, "-me-1 size-9")} aria-label="فتح تفاصيل المهمة" title="فتح التفاصيل" onClick={() => onOpen(t)}>
          <Maximize2 className="size-4" />
        </Button>
      </div>

      {/* tracking row: who's done · my status · discussion · admin menu */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-dashed px-3 py-1.5 sm:px-4">
        {isAdmin &&
          (members.length > 0 ? (
            <MemberStack members={members} doneIds={t.done_ids} onClick={() => onResponses(t)} />
          ) : (
            <ProgressRing done={t.progress.done} total={t.progress.total} size={32} />
          ))}
        {isAdmin && (
          <span className="text-xs tabular-nums text-muted-foreground" aria-hidden={members.length > 0}>
            {t.progress.done}/{t.progress.total} أنجزوا
          </span>
        )}
        {!isAdmin &&
          (ro ? (
            <span className={cn("text-xs font-semibold", complete ? "text-success" : "text-muted-foreground")}>{complete ? "أنجزتها" : "لم تنجزها"}</span>
          ) : dailyOff ? (
            <span className="text-xs font-semibold text-muted-foreground">غير نشطة اليوم</span>
          ) : hasSubs ? (
            <button
              type="button"
              onClick={() => onOpen(t)}
              className="focus-visible:ring-ring/50 flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md px-1 outline-none hover:bg-muted focus-visible:ring-2"
              aria-label={`أنجزت ${myCount} من ${t.subtasks.length} — فتح القائمة`}
            >
              <span className="flex w-14 gap-0.5" aria-hidden>
                {t.subtasks.map((s) => (
                  <span key={s.id} className={cn("h-1.5 flex-1 rounded-full", s.mine?.done ? "bg-success" : "bg-muted")} />
                ))}
              </span>
              <span className="text-xs tabular-nums">
                {myCount}/{t.subtasks.length}
              </span>
            </button>
          ) : (
            <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs font-semibold">
              <Checkbox className={CHECK_CLS} checked={mine.done} onCheckedChange={(v) => mine.toggle(v === true)} />
              {mine.done ? <span className="text-success">{daily ? "أنجزتها اليوم" : "أنجزتها"}</span> : daily ? "أنجزتها اليوم؟" : "أنجزتها؟"}
            </label>
          ))}
        <div className="ms-auto flex items-center">
          <Button
            variant="ghost"
            size="sm"
            className={cn(ICON_BTN, "h-9 gap-1 px-2", t.comment_count && "text-primary")}
            aria-label={`نقاش المهمة (${t.comment_count} تعليق)`}
            onClick={() => onComments(t)}
          >
            <MessageSquare />
            {t.comment_count > 0 ? <span className="tabular-nums">{t.comment_count}</span> : <span className="sr-only">0</span>}
          </Button>
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-lg" className={cn(ICON_BTN, "size-9")} aria-label="خيارات المهمة">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem className="cursor-pointer" onSelect={() => onOpen(t)}>
                  <Maximize2 />
                  التفاصيل
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer" onSelect={() => onResponses(t)}>
                  <Users />
                  تفاصيل الإنجاز
                </DropdownMenuItem>
                {daily && (
                  <DropdownMenuItem className="cursor-pointer" onSelect={() => onDaily(t)}>
                    <CalendarDays />
                    سجل الأيام
                  </DropdownMenuItem>
                )}
                {!ro && (
                  <DropdownMenuItem className="cursor-pointer" onSelect={() => onEdit(t)}>
                    <Pencil />
                    تعديل
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="cursor-pointer" onSelect={() => onArchive(t, ro ? 0 : 1)}>
                  {ro ? <ArchiveRestore /> : <Archive />}
                  {ro ? "استعادة" : "أرشفة"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" className="cursor-pointer" onSelect={() => onDelete(t)}>
                  <Trash2 />
                  حذف
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </Card>
  )
}

type SubForm = { id?: number; title: string; url: string; actions: Action[] }
type Form = {
  id?: number
  group_id: string
  kind: Kind
  title: string
  description: string
  type_id: string
  post_count: string
  category: string
  priority: Priority
  due_date: string
  repeat: boolean
  repeat_from: string
  repeat_until: string
  subs: SubForm[]
}

type Filters = { q: string; kind: string; cat: string; pri: string; status: string }
const NO_FILTERS: Filters = { q: "", kind: "all", cat: "all", pri: "all", status: "all" }
type View = "cards" | "board"

export default function Tasks() {
  const { user } = useAuth()
  const isAdmin = user!.role !== "user"
  const isSuper = user!.role === "super"
  const [tab, setTab] = useState<"active" | "archived">("active")
  const [view, setView] = useState<View>(() => (localStorage.getItem("tasksView") === "board" ? "board" : "cards"))
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [archivedTasks, setArchivedTasks] = useState<Task[] | null>(null)
  const [team, setTeam] = useState<Team | null>(null)
  const [teams, setTeams] = useState<Record<number, Team>>({}) // super: one team per group seen in the lists
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [types, setTypes] = useState<AccountType[]>([])
  const { groups, gid: activeGid } = useScope()   // the workspace switcher owns the group
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [delTask, setDelTask] = useState<Task | null>(null)
  const [respTask, setRespTask] = useState<Task | null>(null)
  const [resp, setResp] = useState<IRow[] | null>(null)
  const [commentsTask, setCommentsTask] = useState<Task | null>(null)
  const [detail, setDetail] = useState<Task | null>(null)
  // bump on popup close → cards remount and pick up toggles made inside the popup (useMine is local-authoritative)
  const [ver, setVer] = useState(0)
  const closeDetail = () => {
    setDetail(null)
    setVer((v) => v + 1)
  }

  const load = () =>
    api
      .get("/tasks")
      .then((ts: Task[]) => {
        setTasks(ts)
        loadTeams(ts)
      })
      .catch((e) => toast.error(e.message))

  const loadArchived = () =>
    api
      .get("/tasks?archived=1")
      .then((ts: Task[]) => {
        setArchivedTasks(ts)
        loadTeams(ts)
      })
      .catch((e) => toast.error(e.message))

  // members/admins: own group for admin+user; super (no group) loads each group seen in the lists
  const loadTeam = () => {
    if (user!.group_id) api.get("/tasks/team").then(setTeam).catch(() => {})
  }
  const loadTeams = (ts: Task[]) => {
    if (!isSuper) return
    for (const gid of new Set(ts.map((t) => t.group_id)))
      api.get(`/tasks/team?group_id=${gid}`).then((tm: Team) => setTeams((m) => ({ ...m, [gid]: tm }))).catch(() => {})
  }
  const teamOf = (gid: number): Team | null => (isSuper ? (teams[gid] ?? null) : team)

  // reload lists after a mutation and ping the sidebar badge
  const refresh = () => {
    void load()
    if (archivedTasks !== null) void loadArchived()
    notify()
  }

  useEffect(() => {
    void load()
    loadTeam()
    // super: unscoped list of all groups' types, used for display + per-group filtering in the form
    api.get("/types").then(setTypes).catch(() => setTypes([]))
    // any save (own toggles included) fires ymc:refresh → keep team board, avatars and lanes live
    const onRefresh = () => {
      loadTeam()
      void load()
    }
    window.addEventListener("ymc:refresh", onRefresh)
    return () => window.removeEventListener("ymc:refresh", onRefresh)
  }, [])

  const onTab = (v: string) => {
    setTab(v as "active" | "archived")
    if (v === "archived" && archivedTasks === null) void loadArchived()
  }
  const onView = (v: View) => {
    setView(v)
    localStorage.setItem("tasksView", v)
  }

  const typeName = (id: number | null) => types.find((t) => t.id === id)?.name

  const today = new Date().toLocaleDateString("en-CA")
  const isCompleted = (t: Task) =>
    isAdmin
      ? t.progress.total > 0 && t.progress.done === t.progress.total
      : t.subtasks.length > 0
        ? t.subtasks.every((s) => !!s.mine?.done)
        : !!t.mine?.done
  const isStarted = (t: Task) => (isAdmin ? t.progress.done > 0 : t.subtasks.some((s) => !!s.mine?.done) || !!t.mine?.done)
  // active daily tasks sort like "due today" so they surface every morning
  const sortDue = (t: Task) => (t.repeat === "daily" ? (t.repeat_active ? today : "9999") : (t.due_date?.slice(0, 10) ?? "9999"))
  const statusOf = (t: Task): Lane => laneOf(isCompleted(t), isStarted(t), t.due_date ? dayDiff(t.due_date.slice(0, 10), today) : null)

  const list = tab === "active" ? tasks : archivedTasks
  const q = filters.q.trim().toLowerCase()
  // base = everything except the status facet, so stat-chip counts stay stable while a chip is active
  const base = (list ?? []).filter((t) => {
    if (q && !(`${t.title} ${t.description ?? ""}`.toLowerCase().includes(q))) return false
    if (filters.kind !== "all" && t.kind !== filters.kind) return false
    if (filters.cat !== "all" && t.category !== filters.cat) return false
    if (filters.pri !== "all" && t.priority !== filters.pri) return false
    return true
  })
  const filtered = base.filter((t) => {
    if (filters.status === "all") return true
    if (filters.status === "open") return !isCompleted(t)
    return statusOf(t) === filters.status
  })
  // smart sort (active tab): overdue first, then nearest due date, then newest
  const shown =
    tab === "active"
      ? [...filtered].sort((a, b) => {
          const ao = statusOf(a) === "overdue" ? 0 : 1
          const bo = statusOf(b) === "overdue" ? 0 : 1
          if (ao !== bo) return ao - bo
          const ad = sortDue(a)
          const bd = sortDue(b)
          if (ad !== bd) return ad < bd ? -1 : 1
          return (b.created_at ?? "").localeCompare(a.created_at ?? "") || b.id - a.id
        })
      : filtered

  const filtersActive =
    q !== "" || filters.kind !== "all" || filters.cat !== "all" || filters.pri !== "all" || filters.status !== "all"
  const categories = [
    ...new Set([...(tasks ?? []), ...(archivedTasks ?? [])].map((t) => t.category).filter((c): c is string => !!c)),
  ].sort()
  const countOf = (lane: Lane) => base.filter((t) => statusOf(t) === lane).length
  const fullyDone = (tasks ?? []).filter((t) => t.progress.total > 0 && t.progress.done === t.progress.total)

  const openEdit = (t: Task) =>
    setForm({
      id: t.id,
      group_id: String(t.group_id),
      kind: t.kind,
      title: t.title,
      description: t.description ?? "",
      type_id: t.type_id ? String(t.type_id) : "",
      post_count: t.post_count ? String(t.post_count) : "",
      category: t.category ?? "",
      priority: t.priority ?? "normal",
      due_date: t.due_date ? t.due_date.slice(0, 10) : "",
      repeat: t.repeat === "daily",
      repeat_from: t.repeat_from ? t.repeat_from.slice(0, 10) : "",
      repeat_until: t.repeat_until ? t.repeat_until.slice(0, 10) : "",
      subs: t.subtasks.map((s) => ({ id: s.id, title: s.title, url: s.url ?? "", actions: (s.actions ?? []) as Action[] })),
    })

  const submit = async () => {
    if (!form) return
    if (!form.title.trim()) return void toast.error("العنوان مطلوب")
    if (isSuper && !form.group_id) return void toast.error("المجموعة مطلوبة")
    const needsType = form.kind === "publish" || form.kind === "create_account"
    const body = {
      ...(isSuper ? { group_id: Number(form.group_id) } : {}),
      kind: form.kind,
      title: form.title.trim(),
      description: form.description.trim() || null,
      type_id: needsType && form.type_id ? Number(form.type_id) : null,
      post_count: needsType && form.post_count ? Number(form.post_count) : null,
      category: form.category.trim() || null,
      priority: form.priority,
      due_date: form.repeat ? null : form.due_date || null,
      repeat: form.repeat ? "daily" : null,
      repeat_from: (form.repeat && form.repeat_from) || null,
      repeat_until: (form.repeat && form.repeat_until) || null,
      subtasks: form.subs
        .filter((s) => s.title.trim())
        .map((s) => ({
          ...(s.id ? { id: s.id } : {}),
          title: s.title.trim(),
          url: s.url.trim() || null,
          // empty selection → null so the subtask keeps its manual done checkbox
          actions: s.actions.length ? s.actions : null,
        })),
    }
    setSaving(true)
    try {
      if (form.id) await api.put(`/tasks/${form.id}`, body)
      else await api.post("/tasks", body)
      toast.success(form.id ? "تم تحديث المهمة" : "تم إنشاء المهمة")
      setForm(null)
      refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!delTask) return
    try {
      await api.del(`/tasks/${delTask.id}`)
      toast.success("تم حذف المهمة")
      setDelTask(null)
      refresh()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const setArchived = async (t: Task, archived: 0 | 1) => {
    try {
      await api.put(`/tasks/${t.id}/archive`, { archived })
      toast.success(archived ? "تمت أرشفة المهمة" : "تمت استعادة المهمة")
      refresh()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const bulkArchive = async () => {
    setBulkBusy(true)
    let n = 0
    for (const t of fullyDone) {
      try {
        await api.put(`/tasks/${t.id}/archive`, { archived: 1 })
        n++
      } catch {
        /* summarized below */
      }
    }
    setBulkBusy(false)
    if (n === fullyDone.length) toast.success(`تمت أرشفة ${n} من المهام المكتملة`)
    else toast.error(`تمت أرشفة ${n} من أصل ${fullyDone.length}`)
    refresh()
  }

  const openResponses = (t: Task) => {
    setRespTask(t)
    setResp(null)
    api
      .get(`/tasks/${t.id}/interactions`)
      .then(setResp)
      .catch((e) => {
        toast.error(e.message)
        setRespTask(null)
      })
  }

  // comment count changes patch the loaded lists in place (no refetch, no card remount)
  const setCommentCount = (id: number, n: number) => {
    const patch = (ts: Task[] | null) => ts && ts.map((t) => (t.id === id ? { ...t, comment_count: n } : t))
    setTasks(patch)
    setArchivedTasks(patch)
  }

  const setSub = (i: number, patch: Partial<SubForm>) =>
    setForm((f) => f && { ...f, subs: f.subs.map((s, j) => (j === i ? { ...s, ...patch } : s)) })

  // responses: one block per member (every member, incl. those who haven't started) — super without a team falls back to responders
  const members = (respTask ? teamOf(respTask.group_id) : team)?.members ?? []
  const responders: { id: number; name: string }[] = members.length
    ? members
    : [...new Map((resp ?? []).map((r) => [r.user_id, { id: r.user_id, name: r.user_name }])).values()]
  const respRows = (uid: number) => (resp ?? []).filter((r) => r.user_id === uid)
  const respStatus = (uid: number): Lane => {
    const rows = respRows(uid)
    if (!respTask) return "todo"
    const done = respTask.subtasks.length
      ? respTask.subtasks.every((s) => rows.some((r) => r.subtask_id === s.id && r.done))
      : rows.some((r) => r.subtask_id === null && r.done)
    return done ? "done" : rows.some((r) => r.done) ? "pending" : "todo"
  }

  const needsType = form && (form.kind === "publish" || form.kind === "create_account")
  // super: only offer types belonging to the task's group
  const typeOpts = isSuper && form ? types.filter((t) => String(t.group_id) === form.group_id) : types

  const ro = tab === "archived" // archived tab is read-only
  const peopleOf = (t: Task | null) => {
    const tm = t ? teamOf(t.group_id) : null
    return tm ? [...tm.admins, ...tm.members] : []
  }

  // live object for the popup (comment counts / progress refresh while it is open)
  const detailTask = detail ? ((list ?? []).find((x) => x.id === detail.id) ?? detail) : null
  const [dailyTask, setDailyTask] = useState<Task | null>(null)

  const card = (t: Task) => (
    <TaskCard
      key={`${t.id}:${ver}`}
      t={t}
      ro={ro}
      isAdmin={isAdmin}
      today={today}
      members={teamOf(t.group_id)?.members ?? []}
      onOpen={setDetail}
      onResponses={openResponses}
      onComments={setCommentsTask}
      onEdit={openEdit}
      onArchive={setArchived}
      onDelete={setDelTask}
      onDaily={setDailyTask}
    />
  )

  return (
    <div className="space-y-4">
      {/* toolbar: tabs + view switch at start, actions at end (shell header owns the page title) */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={tab} onValueChange={onTab}>
            <TabsList className="min-h-11 w-full sm:w-fit">
              <TabsTrigger value="active" className="cursor-pointer px-4">
                النشطة
              </TabsTrigger>
              <TabsTrigger value="archived" className="cursor-pointer px-4">
                الأرشيف
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {tab === "active" && (
            <div className="flex min-h-11 items-center gap-1 rounded-lg bg-muted p-[3px]" role="group" aria-label="طريقة العرض">
              {(
                [
                  { key: "cards", label: "بطاقات", Icon: LayoutGrid },
                  { key: "board", label: "لوحة", Icon: Kanban },
                ] as const
              ).map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  onClick={() => onView(key)}
                  className={`focus-visible:ring-ring/50 inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 ${
                    view === key ? "bg-background text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground"
                  }`}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {isAdmin && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {tab === "active" && fullyDone.length > 0 && (
              <Button
                variant="light"
                size="sm"
                className="min-h-11 w-full cursor-pointer sm:w-auto"
                disabled={bulkBusy}
                onClick={bulkArchive}
              >
                <Archive />
                أرشفة المكتملة
              </Button>
            )}
            <Button
              size="sm"
              className="min-h-11 w-full cursor-pointer sm:w-auto"
              onClick={() =>
                setForm({
                  group_id: activeGid ? String(activeGid) : "",
                  kind: "general",
                  title: "",
                  description: "",
                  type_id: "",
                  post_count: "",
                  category: "",
                  priority: "normal",
                  due_date: "",
                  repeat: false,
                  repeat_from: "",
                  repeat_until: "",
                  subs: [],
                })
              }
            >
              <Plus />
              مهمة جديدة
            </Button>
          </div>
        )}
      </div>

      {/* leaderboard shows peers' progress → group-admin permission */}
      {tab === "active" && isAdmin && (
        <TeamPulse team={team} meId={user!.id} isAdmin={isAdmin} tasks={tasks ?? []} today={today} isCompleted={isCompleted} />
      )}

      {/* filter bar: flush card body, inputs full-width on mobile */}
      <Card className={`${CARD} gap-0 py-0`}>
        <div className="flex flex-col gap-2 p-4 sm:flex-row sm:flex-wrap sm:items-center">
          <Input
            className="min-h-11 w-full sm:w-52"
            placeholder="بحث"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          />
          <Select value={filters.kind} onValueChange={(v) => setFilters({ ...filters, kind: v })}>
            <SelectTrigger className="min-h-11 w-full cursor-pointer sm:w-fit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأنواع</SelectItem>
              {(Object.keys(KINDS) as Kind[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {KINDS[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {categories.length > 0 && (
            <Select value={filters.cat} onValueChange={(v) => setFilters({ ...filters, cat: v })}>
              <SelectTrigger className="min-h-11 w-full cursor-pointer sm:w-fit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الفئات</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={filters.pri} onValueChange={(v) => setFilters({ ...filters, pri: v })}>
            <SelectTrigger className="min-h-11 w-full cursor-pointer sm:w-fit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأولويات</SelectItem>
              {(Object.keys(PRIORITIES) as Priority[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITIES[p].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
            <SelectTrigger className="min-h-11 w-full cursor-pointer sm:w-fit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              <SelectItem value="open">غير مكتملة</SelectItem>
              {LANE_KEYS.map((k) => (
                <SelectItem key={k} value={k}>
                  {LANES[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 w-full cursor-pointer sm:w-auto"
              onClick={() => setFilters(NO_FILTERS)}
            >
              <X />
              مسح المرشحات
            </Button>
          )}
        </div>

        {/* stat chips = quick status filters (Jira-style categories); light badge idle, solid when selected */}
        {list !== null && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-dashed px-4 py-3" role="group" aria-label="تصفية سريعة حسب الحالة">
            {(
              [
                { key: "all", label: "الكل", n: base.length, idle: "bg-primary-light text-primary", active: "bg-primary text-primary-foreground" },
                { key: "todo", label: LANES.todo.label, n: countOf("todo"), idle: "bg-secondary text-muted-foreground", active: "bg-foreground text-background" },
                { key: "pending", label: LANES.pending.label, n: countOf("pending"), idle: "bg-primary-light text-primary", active: "bg-primary text-primary-foreground" },
                { key: "duesoon", label: LANES.duesoon.label, n: countOf("duesoon"), idle: "bg-warning-light text-warning", active: "bg-warning-fill text-neutral-900" },
                { key: "overdue", label: LANES.overdue.label, n: countOf("overdue"), idle: "bg-danger-light text-destructive", active: "bg-destructive text-white" },
                { key: "done", label: LANES.done.label, n: countOf("done"), idle: "bg-success-light text-success", active: "bg-success text-white" },
              ] as const
            ).map((c) => {
              const active = filters.status === c.key
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={active}
                  aria-label={`${c.label}: ${c.n}`}
                  onClick={() => setFilters({ ...filters, status: active && c.key !== "all" ? "all" : c.key })}
                  className={`focus-visible:ring-ring/50 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md px-3 text-xs font-semibold transition-colors duration-200 outline-none focus-visible:ring-2 ${
                    active ? c.active : `${c.idle} hover:opacity-80`
                  }`}
                >
                  {active && <Check className="size-3.5" aria-hidden />}
                  {c.label} <span className="tabular-nums">{c.n}</span>
                </button>
              )
            })}
          </div>
        )}
      </Card>

      {list === null ? (
        <div className="grid gap-3 xl:grid-cols-2">
          <Skeleton className="h-28 w-full rounded-[0.625rem]" />
          <Skeleton className="h-28 w-full rounded-[0.625rem]" />
        </div>
      ) : shown.length === 0 ? (
        <Card className={`${CARD} items-center gap-3 py-12 text-center`}>
          <div className="bg-primary-light text-primary flex size-12 items-center justify-center rounded-md">
            <ClipboardList className="size-6" aria-hidden />
          </div>
          {filtersActive ? (
            <>
              <p className="text-muted-foreground text-sm">لا توجد مهام مطابقة للمرشحات</p>
              <Button variant="light" size="sm" className="min-h-11 cursor-pointer" onClick={() => setFilters(NO_FILTERS)}>
                مسح المرشحات
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">{tab === "archived" ? "لا توجد مهام مؤرشفة" : "لا توجد مهام بعد."}</p>
          )}
        </Card>
      ) : view === "board" && tab === "active" ? (
        // board: one lane per status category; lanes stack on mobile, 2 cols md, 3 xl, all 5 from 2xl
        <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          {LANE_KEYS.map((key) => {
            const lane = LANES[key]
            const items = shown.filter((t) => statusOf(t) === key)
            return (
              <section key={key} aria-label={lane.label} className="space-y-2.5">
                <header className="flex items-center gap-2 px-1 text-sm font-semibold">
                  <span className={`size-2.5 rounded-full ${lane.dot}`} aria-hidden />
                  {lane.label}
                  <span className="rounded-md bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{items.length}</span>
                </header>
                {items.length === 0 ? (
                  <div className="rounded-[0.625rem] border border-dashed px-4 py-5 text-center text-xs text-muted-foreground">لا شيء هنا</div>
                ) : (
                  items.map(card)
                )}
              </section>
            )
          })}
        </div>
      ) : (
        <div className="grid items-start gap-3 xl:grid-cols-2 2xl:grid-cols-3">{shown.map(card)}</div>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "تعديل المهمة" : "مهمة جديدة"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="grid gap-3 sm:grid-cols-2">
              {isSuper && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>المجموعة</Label>
                  <Select
                    value={form.group_id}
                    disabled={!!form.id}
                    onValueChange={(v) => setForm({ ...form, group_id: v, type_id: "" })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="اختر المجموعة" />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={String(g.id)}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>نوع المهمة</Label>
                <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as Kind })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(KINDS) as Kind[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {KINDS[k].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>الأولوية</Label>
                <Select
                  value={form.priority}
                  onValueChange={(v) => setForm({ ...form, priority: v as Priority })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PRIORITIES) as Priority[]).map((p) => (
                      <SelectItem key={p} value={p}>
                        {PRIORITIES[p].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>العنوان</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>الوصف</Label>
                <Textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>الفئة</Label>
                <Input
                  list="task-categories"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                />
                <datalist id="task-categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              {!form.repeat && (
                <div className="space-y-1.5">
                  <Label>تاريخ الاستحقاق</Label>
                  <Input
                    type="date"
                    value={form.due_date}
                    onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                  />
                </div>
              )}
              <div className="space-y-2 rounded-md border p-3 sm:col-span-2">
                <label className="flex cursor-pointer items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Repeat className="size-4 text-info" aria-hidden />
                    مهمة يومية متكررة
                  </span>
                  <Switch checked={form.repeat} onCheckedChange={(v) => setForm({ ...form, repeat: v === true })} />
                </label>
                {form.repeat && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      تتجدد كل يوم ويعيد الأعضاء إنجازها من جديد. اترك التاريخين فارغين لتكون دائمة.
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>من (اختياري)</Label>
                        <Input
                          type="date"
                          value={form.repeat_from}
                          onChange={(e) => setForm({ ...form, repeat_from: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>حتى (اختياري)</Label>
                        <Input
                          type="date"
                          value={form.repeat_until}
                          onChange={(e) => setForm({ ...form, repeat_until: e.target.value })}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
              {needsType && (
                <>
                  <div className="space-y-1.5">
                    <Label>النوع المستهدف</Label>
                    <Select
                      value={form.type_id}
                      onValueChange={(v) => setForm({ ...form, type_id: v })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="اختر النوع" />
                      </SelectTrigger>
                      <SelectContent>
                        {typeOpts.map((t) => (
                          <SelectItem key={t.id} value={String(t.id)}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>عدد المنشورات</Label>
                    <Input
                      type="number"
                      min={1}
                      value={form.post_count}
                      onChange={(e) => setForm({ ...form, post_count: e.target.value })}
                    />
                  </div>
                </>
              )}
              <div className="space-y-2 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <Label>المهام الفرعية</Label>
                  <Button
                    variant="light"
                    size="sm"
                    className="cursor-pointer"
                    onClick={() => setForm({ ...form, subs: [...form.subs, { title: "", url: "", actions: [] }] })}
                  >
                    <Plus />
                    إضافة
                  </Button>
                </div>
                {form.subs.map((s, i) => (
                  <div key={i} className="space-y-2 rounded-md border p-2">
                    {/* title/url stack on mobile, side by side from sm */}
                    <div className="flex items-start gap-2">
                      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                        <Input
                          className="h-9"
                          placeholder="العنوان"
                          value={s.title}
                          onChange={(e) => setSub(i, { title: e.target.value })}
                        />
                        <Input
                          className="h-9"
                          placeholder="الرابط"
                          dir="ltr"
                          value={s.url}
                          onChange={(e) => setSub(i, { url: e.target.value })}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-lg"
                        className={ICON_BTN}
                        aria-label="إزالة المهمة الفرعية"
                        title="إزالة المهمة الفرعية"
                        onClick={() => setForm({ ...form, subs: form.subs.filter((_, j) => j !== i) })}
                      >
                        <X />
                      </Button>
                    </div>
                    {/* required actions for this subtask; none selected = plain manual checkbox */}
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="الإجراءات المطلوبة">
                      {ACTION_KEYS.map((a) => (
                        <ActionChip
                          key={a}
                          action={a}
                          on={s.actions.includes(a)}
                          onToggle={() =>
                            setSub(i, {
                              actions: s.actions.includes(a) ? s.actions.filter((x) => x !== a) : [...s.actions, a],
                            })
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter className="bg-background sticky bottom-0 -mx-6 -mb-6 border-t px-6 py-4">
            <Button variant="light" className="cursor-pointer" onClick={() => setForm(null)}>
              إلغاء
            </Button>
            <Button className="cursor-pointer" onClick={submit} disabled={saving}>
              {form?.id ? "حفظ" : "إنشاء"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delTask} onOpenChange={(o) => !o && setDelTask(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المهمة؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف "{delTask?.title}" وجميع الردود والتعليقات المرتبطة بها نهائيًا.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CommentsDialog task={commentsTask} people={peopleOf(commentsTask)} onClose={() => setCommentsTask(null)} onCount={setCommentCount} />

      <TaskDetailDialog
        task={detailTask}
        ro={ro}
        isAdmin={isAdmin}
        meId={user!.id}
        today={today}
        typeName={typeName}
        members={detailTask ? (teamOf(detailTask.group_id)?.members ?? []) : []}
        admins={detailTask ? (teamOf(detailTask.group_id)?.admins ?? []) : []}
        onClose={closeDetail}
        onComments={setCommentsTask}
        onResponses={(t) => {
          closeDetail()
          openResponses(t)
        }}
        onEdit={(t) => {
          closeDetail()
          openEdit(t)
        }}
        onArchive={(t, a) => {
          closeDetail()
          void setArchived(t, a)
        }}
        onDelete={(t) => {
          closeDetail()
          setDelTask(t)
        }}
      />

      <TaskDailyDialog task={dailyTask} onClose={() => setDailyTask(null)} />

      {/* responses: every member with a status badge — pending members are as visible as done ones */}
      <Dialog open={!!respTask} onOpenChange={(o) => !o && setRespTask(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="break-words">تفاصيل الإنجاز — {respTask?.title}</DialogTitle>
          </DialogHeader>
          {resp === null ? (
            <Skeleton className="h-24 w-full" />
          ) : responders.length === 0 ? (
            <p className="text-muted-foreground text-sm">لا أعضاء في هذه المجموعة بعد.</p>
          ) : (
            // one card per member: identity header + stacked subtask rows (no table → nothing to overflow at 375px)
            <div className="space-y-3">
              {[...responders]
                .sort((a, b) => LANE_KEYS.indexOf(respStatus(a.id)) - LANE_KEYS.indexOf(respStatus(b.id)))
                .map((m) => {
                  const st = respStatus(m.id)
                  const rows = respRows(m.id)
                  const subs = respTask?.subtasks ?? []
                  const taskRow = rows.find((x) => x.subtask_id === null)
                  return (
                    <div key={m.id} className="overflow-hidden rounded-md border">
                      <div className="bg-muted/50 flex items-center gap-2 border-b px-3 py-2">
                        <span
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-bold",
                            st === "done" ? "bg-success text-white" : "bg-primary-light text-primary",
                          )}
                          aria-hidden
                        >
                          {initials(m.name)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={m.name}>
                          {m.name}
                        </span>
                        <Badge variant={st === "done" ? "success" : st === "pending" ? "primary-light" : "secondary"}>
                          {st === "done" ? "منجز" : st === "pending" ? "قيد التنفيذ" : "لم يبدأ"}
                        </Badge>
                      </div>
                      <div className="divide-y divide-dashed px-3">
                        {subs.length === 0 ? (
                          <DoneText mine={taskRow ? { done: taskRow.done, notes: taskRow.notes } : undefined} />
                        ) : (
                          subs.map((s) => {
                            const r = rows.find((x) => x.subtask_id === s.id)
                            return (
                              <DoneText
                                key={s.id}
                                label={s.title}
                                actions={s.actions}
                                mine={r ? { done: r.done, notes: r.notes, actions_done: r.actions_done } : undefined}
                              />
                            )
                          })
                        )}
                        {subs.length > 0 && taskRow?.notes && <p className="text-muted-foreground py-1.5 text-xs">ملاحظة: {taskRow.notes}</p>}
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
