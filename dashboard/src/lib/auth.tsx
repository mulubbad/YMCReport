import { createContext, useContext, useState, type ReactNode } from "react"
import { api } from "./api"
import { forgetPush } from "./push"

export type User = {
  id: number
  username: string
  name: string
  role: "super" | "admin" | "user"
  group_id: number | null
}

type AuthCtx = {
  user: User | null
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem("user")
    return raw ? JSON.parse(raw) : null
  })

  const login = async (username: string, password: string) => {
    const { token, user } = await api.post("/login", { username, password })
    localStorage.setItem("token", token)
    localStorage.setItem("user", JSON.stringify(user))
    setUser(user)
  }

  const logout = () => {
    forgetPush()
    localStorage.removeItem("token")
    localStorage.removeItem("user")
    setUser(null)
  }

  // pull fresh identity from the server (e.g. after an approved profile-change request)
  const refresh = async () => {
    const u = await api.get("/me")
    setUser((prev) => {
      if (!prev) return prev
      const next = { ...prev, username: u.username, name: u.name, role: u.role, group_id: u.group_id }
      localStorage.setItem("user", JSON.stringify(next))
      return next
    })
  }

  return <Ctx.Provider value={{ user, login, logout, refresh }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useAuth outside AuthProvider")
  return ctx
}
