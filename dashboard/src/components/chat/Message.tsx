import { Copy, MoreHorizontal, Pin, PinOff, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { User } from "@/lib/auth"
import { ROLE_LABEL, initials, parseUtc } from "@/components/tasks/shared"
import type { ChatMsg, Member } from "./stream"

// MASTER §3 role mapping: super=danger, admin=primary, user=success
export const ROLE_VARIANT = { super: "danger", admin: "primary-light", user: "success" } as const
export const ROLE_TILE = {
  super: "bg-danger-light text-destructive",
  admin: "bg-primary-light text-primary",
  user: "bg-success-light text-success",
} as const

const PART = /(@[\p{L}\p{N}_.-]+|#[\p{L}\p{N}_]+)/u
const chip = "inline-flex items-center rounded-badge bg-primary-light px-1.5 text-[0.9em] font-semibold text-primary"

function Body({ body, byUsername, onTag }: { body: string; byUsername: Map<string, Member>; onTag: (t: string) => void }) {
  return (
    <p className="text-sm break-words whitespace-pre-wrap">
      {body.split(PART).map((part, i) => {
        if (part.startsWith("@")) {
          const u = part.slice(1)
          const name = u === "all" ? "الجميع" : byUsername.get(u.toLowerCase())?.name
          if (name)
            return (
              <span key={i} className={chip}>
                @{name}
              </span>
            )
        } else if (part.startsWith("#")) {
          const tag = part.slice(1).toLowerCase()
          return (
            <button
              key={i}
              type="button"
              className={cn(chip, "transition-colors duration-150 outline-none hover:bg-primary hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring/50")}
              aria-label={`تصفية بالوسم ${part}`}
              onClick={() => onTag(tag)}
            >
              {part}
            </button>
          )
        }
        return part
      })}
    </p>
  )
}

export function Message({
  m,
  me,
  byUsername,
  highlighted,
  onTag,
  onImage,
  onPin,
  onDelete,
}: {
  m: ChatMsg
  me: User
  byUsername: Map<string, Member>
  highlighted: boolean
  onTag: (t: string) => void
  onImage: (url: string) => void
  onPin: (m: ChatMsg) => void
  onDelete: (m: ChatMsg) => void
}) {
  const mine = m.user_id === me.id
  const manager = me.role === "admin" || me.role === "super"
  const canDelete = !m.deleted && (mine || manager)
  const canPin = !m.deleted && manager
  const when = parseUtc(m.created_at)
  const name = m.user_name ?? "مستخدم محذوف"
  const role = m.user_role

  const copy = () =>
    navigator.clipboard
      .writeText(m.body ?? "")
      .then(() => toast.success("نُسخت الرسالة"))
      .catch(() => toast.error("تعذر النسخ"))

  return (
    <li
      id={`msg-${m.id}`}
      className={cn(
        "group relative flex w-fit max-w-[85%] flex-col gap-1 rounded-lg px-3 py-2 transition-shadow duration-300 md:max-w-[70%]",
        mine ? "ms-auto bg-primary-light" : "me-auto border border-secondary bg-card shadow-card",
        highlighted && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      <div className="flex items-center gap-2">
        {!mine && (
          <span
            aria-hidden
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
              role ? ROLE_TILE[role] : "bg-muted text-muted-foreground",
            )}
          >
            {initials(name) || "؟"}
          </span>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          {!mine && <span className="truncate text-sm font-semibold">{name}</span>}
          {!mine && role && <Badge variant={ROLE_VARIANT[role]}>{ROLE_LABEL[role]}</Badge>}
          <time
            className="text-xs text-muted-foreground tabular-nums"
            dateTime={when.toISOString()}
            title={when.toLocaleString("en-GB", { hour12: false })}
          >
            {when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </time>
          {m.pinned === 1 && (
            <span className="inline-flex items-center gap-1 text-xs text-primary">
              <Pin className="size-3" aria-hidden />
              مثبّتة
            </span>
          )}
        </div>
        {!m.deleted && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-lg"
                className="-my-2 -me-2 ms-auto shrink-0 text-muted-foreground transition-opacity duration-150 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
                aria-label="خيارات الرسالة"
              >
                <MoreHorizontal className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {m.body && (
                <DropdownMenuItem onClick={copy}>
                  <Copy />
                  نسخ
                </DropdownMenuItem>
              )}
              {canPin && (
                <DropdownMenuItem onClick={() => onPin(m)}>
                  {m.pinned ? <PinOff /> : <Pin />}
                  {m.pinned ? "إلغاء التثبيت" : "تثبيت"}
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem variant="destructive" onClick={() => onDelete(m)}>
                  <Trash2 />
                  حذف الرسالة
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {m.deleted ? (
        <p className="text-sm text-muted-foreground italic">تم حذف الرسالة</p>
      ) : (
        <>
          {m.body && <Body body={m.body} byUsername={byUsername} onTag={onTag} />}
          {m.image_url && (
            <button
              type="button"
              className="w-fit overflow-hidden rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label="عرض الصورة بالحجم الكامل"
              onClick={() => onImage(m.image_url!)}
            >
              <img
                src={m.image_url}
                alt={`صورة من ${name}`}
                loading="lazy"
                className="max-h-80 max-w-full rounded-md object-cover transition-opacity duration-150 hover:opacity-90 sm:max-w-[320px]"
              />
            </button>
          )}
        </>
      )}
    </li>
  )
}
