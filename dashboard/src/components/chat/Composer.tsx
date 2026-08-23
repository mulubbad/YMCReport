import { useEffect, useMemo, useRef, useState } from "react"
import { Hash, ImagePlus, Loader2, Send, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { initials } from "@/components/tasks/shared"
import type { Member, Tag } from "./stream"

const MAX = 2000
const MAX_IMAGE = 5 * 1024 * 1024
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]
// "@name" / "#tag" token right before the caret (Arabic + Latin letters)
const TOKEN = /(^|\s)([@#])([\p{L}\p{N}_.-]*)$/u
const MAX_ROWS_PX = 160 // ≈ 6 rows

type Ac = { type: "@" | "#"; query: string; start: number }
type Item = { key: string; label: string; sub: string }

const detect = (el: HTMLTextAreaElement): Ac | null => {
  const caret = el.selectionStart
  const m = TOKEN.exec(el.value.slice(0, caret))
  return m ? { type: m[2] as Ac["type"], query: m[3], start: caret - m[2].length - m[3].length } : null
}

export function Composer({
  members,
  tags,
  onSend,
}: {
  members: Member[]
  tags: Tag[]
  onSend: (body: string, file: File | null) => Promise<void>
}) {
  const [text, setText] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [ac, setAc] = useState<Ac | null>(null)
  const [active, setActive] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // auto-grow up to ~6 rows (works in every browser, unlike field-sizing)
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`
  }, [text])

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  const items = useMemo<Item[]>(() => {
    if (!ac) return []
    const q = ac.query.toLowerCase()
    if (ac.type === "@") {
      const all: Item[] = [
        { key: "all", label: "الجميع", sub: "@all" },
        ...members.map((m) => ({ key: m.username, label: m.name, sub: `@${m.username}` })),
      ]
      return all.filter((i) => !q || i.label.toLowerCase().includes(q) || i.key.toLowerCase().includes(q)).slice(0, 8)
    }
    return tags
      .filter((t) => !q || t.tag.includes(q))
      .map((t) => ({ key: t.tag, label: `#${t.tag}`, sub: `${t.count}` }))
      .slice(0, 8)
  }, [ac, members, tags])
  useEffect(() => setActive(0), [ac?.type, ac?.query])

  const pick = (item: Item) => {
    const el = area.current
    if (!el || !ac) return
    const before = text.slice(0, ac.start)
    const ins = `${ac.type}${item.key} `
    setText(before + ins + text.slice(el.selectionStart))
    setAc(null)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(before.length + ins.length, before.length + ins.length)
    })
  }

  const choose = (f: File | null) => {
    if (!f) return
    if (!IMAGE_TYPES.includes(f.type)) return void toast.error("الصيغة غير مدعومة — JPG أو PNG أو WebP أو GIF")
    if (f.size > MAX_IMAGE) return void toast.error("حجم الصورة يتجاوز 5 ميجابايت")
    setFile(f)
  }

  const submit = async () => {
    const body = text.trim()
    if (busy || (!body && !file)) return
    if (body.length > MAX) return void toast.error(`الرسالة طويلة — الحد ${MAX} حرف`)
    setBusy(true)
    try {
      await onSend(body, file)
      setText("")
      setFile(null)
      setAc(null)
      if (fileInput.current) fileInput.current.value = ""
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
      area.current?.focus()
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (ac && items.length) {
      if (e.key === "ArrowDown") return void (e.preventDefault(), setActive((i) => (i + 1) % items.length))
      if (e.key === "ArrowUp") return void (e.preventDefault(), setActive((i) => (i - 1 + items.length) % items.length))
      if (e.key === "Enter" || e.key === "Tab") return void (e.preventDefault(), pick(items[active]))
      if (e.key === "Escape") return void (e.preventDefault(), setAc(null))
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }
  const sync = () => area.current && setAc(detect(area.current))
  const open = !!ac && items.length > 0

  return (
    <div className="shrink-0 border-t border-secondary p-3">
      {preview && (
        <div className="relative mb-2 w-fit">
          <img src={preview} alt="معاينة الصورة المرفقة" className="max-h-24 rounded-md border" />
          <Button
            variant="secondary"
            size="icon-sm"
            className="absolute -top-2 -end-2 rounded-full shadow"
            aria-label="إزالة الصورة"
            onClick={() => {
              setFile(null)
              if (fileInput.current) fileInput.current.value = ""
            }}
          >
            <X />
          </Button>
        </div>
      )}
      <div className="relative flex items-end gap-2">
        {open && (
          <ul
            id="chat-ac"
            role="listbox"
            aria-label={ac!.type === "@" ? "الإشارة إلى عضو" : "الوسوم"}
            className="absolute bottom-full start-0 z-10 mb-1 max-h-64 w-72 max-w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {items.map((it, i) => (
              <li
                key={it.key}
                id={`chat-ac-${i}`}
                role="option"
                aria-selected={i === active}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm",
                  i === active ? "bg-primary-light text-primary" : "hover:bg-accent",
                )}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault() // keep the textarea focused
                  pick(it)
                }}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold">
                  {ac!.type === "@" ? initials(it.label) || "@" : <Hash className="size-4" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                <span className="text-xs text-muted-foreground" dir="ltr">
                  {it.sub}
                </span>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => choose(e.target.files?.[0] ?? null)}
        />
        <Button
          variant="ghost"
          size="icon-lg"
          className="h-11 w-11 shrink-0 text-muted-foreground hover:text-primary"
          aria-label="إرفاق صورة"
          title="إرفاق صورة"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          <ImagePlus className="size-5" />
        </Button>
        <Textarea
          ref={area}
          rows={1}
          value={text}
          maxLength={MAX}
          disabled={busy}
          placeholder="اكتب رسالة… (@ للإشارة، # للوسم)"
          aria-label="رسالة جديدة"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? "chat-ac" : undefined}
          aria-activedescendant={open ? `chat-ac-${active}` : undefined}
          className="min-h-11 resize-none py-2.5"
          onChange={(e) => {
            setText(e.target.value)
            sync()
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => (e.key === "ArrowLeft" || e.key === "ArrowRight") && sync()}
          onClick={sync}
          onBlur={() => setAc(null)}
        />
        <Button
          className="h-11 shrink-0 px-3 sm:px-4"
          aria-label="إرسال"
          title="Enter للإرسال، Shift+Enter لسطر جديد"
          disabled={busy || (!text.trim() && !file)}
          onClick={submit}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Send className="rtl:-scale-x-100" />}
          <span className="hidden sm:inline">{busy ? "جارٍ الإرسال…" : "إرسال"}</span>
        </Button>
      </div>
    </div>
  )
}
