import { useEffect, useRef, useState } from "react"
import { Lock, MessageSquare, Send, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { useAuth, type User } from "@/lib/auth"
import { cn } from "@/lib/utils"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ROLE_LABEL, ago, initials, notify, parseUtc } from "@/components/tasks/shared"

// CONTRACT.md → Private notes: GET /notes?type&id · POST /notes · DELETE /notes/:id
export type NoteType = "account" | "page" | "sim"
type Note = {
  id: number
  body: string
  author_id: number | null
  author_name: string | null
  author_role: User["role"] | null
  created_at: string
}

// MASTER §3 role mapping: super=danger, admin=primary, user=success
const ROLE_VARIANT = { super: "danger", admin: "primary-light", user: "success" } as const
const MAX = 2000

/** Row action: MessageSquare + count chip (shared by accounts, pages, SIM rows). */
export function NotesButton({ count, label, onClick }: { count: number | null | undefined; label: string; onClick: () => void }) {
  const n = count ?? 0
  return (
    <Button
      variant="ghost"
      size="icon-lg"
      className={cn("relative", n > 0 && "text-primary")}
      aria-label={`${label} (${n})`}
      title={label}
      onClick={onClick}
    >
      <MessageSquare />
      {n > 0 && (
        <span
          aria-hidden
          className="absolute -top-0.5 -end-0.5 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums"
        >
          {n > 99 ? "99+" : n}
        </span>
      )}
    </Button>
  )
}

export function NotesThread({ type, id, title, onChange }: { type: NoteType; id: number; title: string; onChange?: () => void }) {
  const me = useAuth().user!
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<Note | null>(null)
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    setNotes(null)
    api.get(`/notes?type=${type}&id=${id}`).then(setNotes).catch((e) => toast.error(e.message))
  }, [type, id])

  // newest note at the bottom → keep it in view (scrolls the list only, not the dialog)
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [notes?.length])

  const changed = () => {
    notify()
    onChange?.()
  }

  const send = async () => {
    const text = body.trim()
    if (!text || busy) return
    if (text.length > MAX) return toast.error(`الملاحظة طويلة — الحد ${MAX} حرف`)
    setBusy(true)
    try {
      const n: Note = await api.post("/notes", { type, id, body: text })
      setNotes((l) => [...(l ?? []), n])
      setBody("")
      toast.success("أُرسلت الملاحظة")
      changed()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!deleting) return
    try {
      await api.del(`/notes/${deleting.id}`)
      setNotes((l) => (l ?? []).filter((n) => n.id !== deleting.id))
      setDeleting(null)
      toast.success("حُذفت الملاحظة")
      changed()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const hint = me.role === "user" ? "هذه الملاحظات مرئية لك ولقائد الفريق فقط" : "مرئية لك وللعضو فقط"

  return (
    <div className="space-y-3">
      {notes === null ? (
        <div className="space-y-3" aria-busy>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-10 rounded-lg" />
              <div className="flex-1 space-y-2 pt-1">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : notes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary-light text-primary">
            <Lock className="size-5" />
          </div>
          <p className="text-sm text-muted-foreground">لا توجد ملاحظات خاصة بعد — ابدأ المحادثة</p>
        </div>
      ) : (
        <ol ref={listRef} className="max-h-[45dvh] space-y-3 overflow-y-auto" aria-label={`الملاحظات الخاصة — ${title}`}>
          {notes.map((n) => {
            const role = n.author_role
            const name = n.author_name ?? "مستخدم محذوف"
            const leader = role === "admin" || role === "super"
            const canDelete = n.author_id === me.id || me.role === "super"
            return (
              <li key={n.id} className="flex gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold",
                    !role ? "bg-muted text-muted-foreground" : leader ? "bg-primary-light text-primary" : "bg-success-light text-success",
                  )}
                >
                  {initials(name) || "؟"}
                </span>
                <div className="min-w-0 flex-1 rounded-lg border border-dashed px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold">{name}</span>
                    {role && <Badge variant={ROLE_VARIANT[role]}>{ROLE_LABEL[role]}</Badge>}
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={parseUtc(n.created_at).toISOString()}
                      title={parseUtc(n.created_at).toLocaleString("en-GB", { hour12: false })}
                    >
                      {ago(n.created_at)}
                    </time>
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="icon-lg"
                        className="ms-auto -me-2 -my-1 text-muted-foreground hover:text-destructive"
                        aria-label="حذف الملاحظة"
                        title="حذف"
                        onClick={() => setDeleting(n)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                  <p className="mt-1 text-sm break-words whitespace-pre-wrap">{n.body}</p>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <div className="space-y-2">
        <Textarea
          rows={3}
          maxLength={MAX}
          placeholder="اكتب ملاحظة خاصة…"
          aria-label={`ملاحظة خاصة جديدة — ${title}`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5 shrink-0" />
            {hint}
          </p>
          <Button className="h-11 w-full sm:w-auto" onClick={send} disabled={busy || !body.trim()} title="Ctrl/⌘ + Enter">
            <Send className="rtl:-scale-x-100" />
            {busy ? "جارٍ الإرسال…" : "إرسال"}
          </Button>
        </div>
      </div>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الملاحظة؟</AlertDialogTitle>
            <AlertDialogDescription>ستُحذف الملاحظة نهائيًا ولن يراها الطرف الآخر.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
