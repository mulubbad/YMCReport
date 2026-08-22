// Per-task team discussion: thread + composer with @mentions (names from the group's people list)
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { AtSign, MessageSquare, RefreshCw, Send, Trash2 } from "lucide-react"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ICON_BTN, ROLE_LABEL, ago, initials, type Comment, type Person, type Task } from "./shared"

const MAX = 2000
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// highlight "@Name" for known people (longest names first so "محمد علي" wins over "محمد")
function Body({ text, names }: { text: string; names: string[] }) {
  if (!names.length) return <>{text}</>
  const re = new RegExp(`@(${[...names].sort((a, b) => b.length - a.length).map(esc).join("|")})`, "g")
  const out: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    out.push(text.slice(last, m.index))
    out.push(
      <span key={m.index} className="rounded-sm bg-primary-light px-1 font-semibold text-primary">
        @{m[1]}
      </span>,
    )
    last = m.index! + m[0].length
  }
  out.push(text.slice(last))
  return <>{out}</>
}

const tileTint = (role: Comment["user_role"]) =>
  role === "user" ? "bg-success-light text-success" : "bg-primary-light text-primary"

export function CommentsDialog({
  task,
  people,
  onClose,
  onCount,
}: {
  task: Task | null
  people: Person[]
  onClose: () => void
  onCount: (taskId: number, n: number) => void
}) {
  const me = useAuth().user!
  const canModerate = me.role !== "user"
  const [list, setList] = useState<Comment[] | null>(null)
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)
  const [del, setDel] = useState<Comment | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const names = people.map((p) => p.name)

  const load = () => {
    if (!task) return
    api
      .get(`/tasks/${task.id}/comments`)
      .then((rows: Comment[]) => {
        setList(rows)
        onCount(task.id, rows.length)
      })
      .catch((e) => toast.error(e.message))
  }

  useEffect(() => {
    setList(null)
    setBody("")
    load()
  }, [task?.id])

  // keep the newest message in view
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" })
  }, [list?.length])

  const submit = async () => {
    if (!task || sending) return
    const text = body.trim()
    if (!text) return
    setSending(true)
    try {
      const row: Comment = await api.post(`/tasks/${task.id}/comments`, { body: text })
      const next = [...(list ?? []), row]
      setList(next)
      onCount(task.id, next.length)
      setBody("")
      input.current?.focus()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  const confirmDelete = async () => {
    if (!del || !task) return
    try {
      await api.del(`/comments/${del.id}`)
      const next = (list ?? []).filter((c) => c.id !== del.id)
      setList(next)
      onCount(task.id, next.length)
      setDel(null)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const mention = (name: string) => {
    setBody((b) => `${b}${b && !/\s$/.test(b) ? " " : ""}@${name} `)
    // focus after the menu closes
    setTimeout(() => input.current?.focus(), 0)
  }

  return (
    <>
      <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="flex max-h-[90dvh] flex-col gap-0 p-0 sm:max-w-lg">
          <DialogHeader className="border-b px-6 py-4 pe-12">
            <DialogTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="size-4 text-primary" aria-hidden />
              <span className="min-w-0 break-words">نقاش — {task?.title}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              ناقش التفاصيل مع الفريق واذكر زميلًا بـ @ ليراه بوضوح.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4" aria-live="polite">
            {list === null ? (
              <>
                <Skeleton className="h-14 w-4/5" />
                <Skeleton className="ms-auto h-14 w-3/5" />
              </>
            ) : list.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <div className="flex size-12 items-center justify-center rounded-md bg-primary-light text-primary">
                  <MessageSquare className="size-6" aria-hidden />
                </div>
                <p className="text-sm text-muted-foreground">لا توجد تعليقات بعد — ابدأ النقاش.</p>
              </div>
            ) : (
              list.map((c) => {
                const own = c.user_id === me.id
                return (
                  <div key={c.id} className={`flex items-start gap-2.5 ${own ? "flex-row-reverse" : ""}`}>
                    <span
                      className={`flex size-9 shrink-0 items-center justify-center rounded-md text-xs font-bold ${tileTint(c.user_role)}`}
                      aria-hidden
                    >
                      {initials(c.user_name ?? "؟")}
                    </span>
                    <div className={`group min-w-0 max-w-[85%] ${own ? "text-end" : ""}`}>
                      <div className={`mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs ${own ? "justify-end" : ""}`}>
                        <span className="font-semibold text-foreground">{own ? "أنت" : (c.user_name ?? "مستخدم محذوف")}</span>
                        {c.user_role && c.user_role !== "user" && (
                          <span className="rounded-sm bg-primary-light px-1 text-[10px] font-semibold text-primary">
                            {ROLE_LABEL[c.user_role]}
                          </span>
                        )}
                        <time className="text-muted-foreground" dateTime={c.created_at} title={c.created_at}>
                          {ago(c.created_at)}
                        </time>
                      </div>
                      <div
                        className={`inline-block rounded-lg px-3 py-2 text-start text-sm break-words whitespace-pre-wrap ${
                          own ? "bg-primary text-primary-foreground [&_span]:bg-white/20 [&_span]:text-white" : "bg-muted"
                        }`}
                      >
                        <Body text={c.body} names={names} />
                      </div>
                      {(own || canModerate) && (
                        <div className={own ? "text-start" : ""}>
                          <Button
                            variant="ghost"
                            size="icon-lg"
                            className={`${ICON_BTN} hover:bg-danger-light hover:text-destructive`}
                            aria-label="حذف التعليق"
                            title="حذف التعليق"
                            onClick={() => setDel(c)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
            <div ref={end} />
          </div>

          <div className="border-t bg-background px-6 py-3">
            <Textarea
              ref={input}
              rows={2}
              maxLength={MAX}
              placeholder="اكتب تعليقًا… (Ctrl+Enter للإرسال)"
              aria-label="تعليق جديد"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault()
                  void submit()
                }
              }}
            />
            <div className="mt-2 flex items-center gap-1">
              {people.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="min-h-10 cursor-pointer" aria-label="ذكر زميل">
                      <AtSign />
                      ذكر
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-64 w-56 overflow-y-auto">
                    {people.map((p) => (
                      <DropdownMenuItem key={p.id} className="cursor-pointer" onSelect={() => mention(p.name)}>
                        <span className="flex size-6 items-center justify-center rounded-sm bg-primary-light text-[10px] font-bold text-primary" aria-hidden>
                          {initials(p.name)}
                        </span>
                        <span className="truncate">{p.name}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button variant="ghost" size="icon-lg" className={ICON_BTN} aria-label="تحديث التعليقات" title="تحديث" onClick={load}>
                <RefreshCw className="size-4" />
              </Button>
              <span className="ms-auto text-[11px] tabular-nums text-muted-foreground" aria-hidden>
                {body.length}/{MAX}
              </span>
              <Button className="min-h-10 cursor-pointer" disabled={sending || !body.trim()} onClick={submit}>
                <Send />
                إرسال
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف التعليق؟</AlertDialogTitle>
            <AlertDialogDescription>سيتم حذف التعليق نهائيًا.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
