import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom"
import { Direction } from "radix-ui"
import { Toaster } from "@/components/ui/sonner"
import Layout from "@/components/Layout"
import { AuthProvider, useAuth, type User } from "@/lib/auth"
import Accounts from "@/pages/Accounts"
import Chat from "@/pages/Chat"
import Dashboard from "@/pages/Dashboard"
import Export from "@/pages/Export"
import Groups from "@/pages/Groups"
import Login from "@/pages/Login"
import Notifications from "@/pages/Notifications"
import Settings from "@/pages/Settings"
import Profile from "@/pages/Profile"
import Sims from "@/pages/Sims"
import Tasks from "@/pages/Tasks"
import Users from "@/pages/Users"

function Protected() {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return (
    <Layout>
      <Outlet />
    </Layout>
  )
}

function RequireRole({ roles }: { roles: User["role"][] }) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />
  return <Outlet />
}

export default function App() {
  return (
    <Direction.Provider dir="rtl">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Protected />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/sims" element={<Sims />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/chat" element={<Chat />} />
              <Route element={<RequireRole roles={["admin", "super"]} />}>
                <Route path="/users" element={<Users />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/export" element={<Export />} />
              </Route>
              <Route element={<RequireRole roles={["super"]} />}>
                <Route path="/groups" element={<Groups />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster dir="rtl" />
      </AuthProvider>
    </Direction.Provider>
  )
}
