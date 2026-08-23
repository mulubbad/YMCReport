import { useEffect, useRef, useState } from "react"
import { BASE, getToken } from "@/lib/api"
import type { User } from "@/lib/auth"

// CONTRACT.md → Group chat: shapes of /api/chat/* rows and SSE events
export type Role = User["role"]
export type ChatMsg = {
  id: number
  user_id: number | null
  user_name: string | null
  user_role: Role | null
  body: string | null
  image_url: string | null
  mentions: { id: number; name: string }[]
  hashtags: string[]
  pinned: number
  deleted: number
  created_at: string
}
export type Member = { id: number; name: string; username: string; role: Role; online: boolean | number }
export type Tag = { tag: string; count: number }

type Handlers = {
  message: (m: ChatMsg) => void
  deleted: (d: { id: number }) => void
  pinned: (d: { id: number; pinned: number }) => void
  presence: (d: { online: number[] }) => void
  reconnect?: () => void // fired after the stream comes back so the page can refetch what it missed
}

/**
 * One EventSource for the mounted page (closed on unmount). `reconnecting` is true while retrying after an error.
 * Network drops retry natively (readyState CONNECTING); a 5xx from a proxy while the API restarts closes the
 * source for good (readyState CLOSED), so that case is retried here with backoff.
 * `enabled=false` (super before a group is chosen) keeps the socket closed.
 */
export function useChatStream(groupId: number | undefined, handlers: Handlers, enabled = true) {
  const [reconnecting, setReconnecting] = useState(false)
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    const token = getToken()
    if (!enabled || !token) return
    const q = new URLSearchParams({ token })
    if (groupId) q.set("group_id", String(groupId))
    let es: EventSource | undefined
    let timer: number | undefined
    let delay = 2000
    let dropped = false
    const connect = () => {
      es = new EventSource(`${BASE}/api/chat/stream?${q}`)
      for (const ev of ["message", "deleted", "pinned", "presence"] as const)
        es.addEventListener(ev, (e) => (ref.current[ev] as (d: unknown) => void)(JSON.parse((e as MessageEvent).data)))
      es.onopen = () => {
        delay = 2000
        setReconnecting(false)
        if (dropped) ref.current.reconnect?.()
        dropped = false
      }
      es.onerror = () => {
        dropped = true
        setReconnecting(true)
        if (es!.readyState === EventSource.CLOSED) {
          timer = window.setTimeout(connect, delay)
          delay = Math.min(delay * 2, 30_000)
        }
      }
    }
    connect()
    return () => {
      window.clearTimeout(timer)
      es?.close()
      setReconnecting(false)
    }
  }, [groupId, enabled])

  return reconnecting
}
