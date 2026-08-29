import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { api, setActiveGroup } from "./api"
import { useAuth } from "./auth"

// A leader may run SEVERAL groups. Exactly one is active at a time and every request carries it
// (api.ts appends ?group_id), so each group behaves as its own encapsulated workspace.
// Members never have a scope: their group is implicit on the server.

export type ManagedGroup = {
  id: number
  name: string
  user_count: number
  member_count: number
  account_count: number
  sim_count: number
  task_count: number
}

type ScopeCtx = {
  groups: ManagedGroup[]
  gid: number | null // null = every group (super only)
  active: ManagedGroup | null
  setGid: (id: number | null) => void
  multi: boolean // more than one choice → render the switcher
  loading: boolean
  reload: () => void
}

const Ctx = createContext<ScopeCtx | null>(null)
const STORE = "ymc:gid"

export function ScopeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const leader = !!user && user.role !== "user"
  const [groups, setGroups] = useState<ManagedGroup[]>([])
  const [gid, setGidState] = useState<number | null>(null)
  const [loading, setLoading] = useState(leader)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!leader) {
      setGroups([])
      setGidState(null)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    api
      .get("/groups")
      .then((rows: ManagedGroup[]) => {
        if (!alive) return
        setGroups(rows)
        const stored = Number(localStorage.getItem(STORE)) || null
        const keep = stored && rows.some((g) => g.id === stored) ? stored : null
        // a super defaults to "every group" (its historical view); an admin always lands inside one
        setGidState(keep ?? (user!.role === "admin" ? (rows[0]?.id ?? null) : null))
      })
      .catch(() => alive && setGroups([]))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [leader, user?.id, nonce])

  const setGid = (id: number | null) => {
    if (id == null) localStorage.removeItem(STORE)
    else localStorage.setItem(STORE, String(id))
    setGidState(id)
  }

  // written during render, not in an effect: child effects run before parent effects, so an effect
  // here would let the first page fetch go out unscoped.
  setActiveGroup(gid)

  const value: ScopeCtx = {
    groups,
    gid,
    active: groups.find((g) => g.id === gid) ?? null,
    setGid,
    multi: groups.length > 1,
    loading,
    reload: () => setNonce((n) => n + 1),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useScope() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useScope outside ScopeProvider")
  return ctx
}
