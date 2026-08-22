import { createContext, useContext, useState, type ReactNode } from "react"
import { api } from "./api"

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
    localStorage.removeItem("token")
    localStorage.removeItem("user")
    setUser(null)
  }

  return <Ctx.Provider value={{ user, login, logout }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useAuth outside AuthProvider")
  return ctx
}
