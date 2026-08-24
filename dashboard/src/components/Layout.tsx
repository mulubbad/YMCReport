import { useEffect, useRef, useState, type ReactNode } from "react"
import { Link, NavLink, useLocation } from "react-router-dom"
import {
  AtSign,
  Bell,
  Building2,
  ClipboardList,
  Download,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  Settings,
  Smartphone,
  Sun,
  UserRound,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { Brand } from "@/components/Logo"
import { Pwa } from "@/components/Pwa"
import { NotificationBell } from "@/components/Notifications"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"

// sidebar sections: daily work first, then administration, then reporting (sections with no visible items are hidden)
const nav = [
  { to: "/", label: "لوحة التحكم", icon: LayoutDashboard, section: "نظرة عامة" },
  { to: "/profile", label: "الملف الشخصي", icon: UserRound, section: "نظرة عامة" },
  { to: "/accounts", label: "الحسابات", icon: AtSign, section: "العمل" },
  { to: "/sims", label: "خطوط الاتصال", icon: Smartphone, section: "العمل" },
  { to: "/tasks", label: "المهام", icon: ClipboardList, section: "العمل" },
  { to: "/notifications", label: "الإشعارات", icon: Bell, section: "العمل" },
  { to: "/chat", label: "المحادثة", icon: MessageSquareText, section: "العمل" },
  { to: "/users", label: "المستخدمون", icon: Users, roles: ["admin", "super"], section: "الإدارة" },
  { to: "/groups", label: "المجموعات", icon: Building2, roles: ["super"], section: "الإدارة" },
  { to: "/settings", label: "الإعدادات", icon: Settings, roles: ["admin", "super"], section: "الإدارة" },
  { to: "/export", label: "تصدير التقارير", icon: Download, roles: ["admin", "super"], section: "التقارير" },
]
const sections = [...new Set(nav.map((n) => n.section))]

const roleLabels = { super: "مشرف عام", admin: "مدير مجموعة", user: "عضو" }

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(0)
  const [chatUnread, setChatUnread] = useState(0)
  const firstItem = useRef<HTMLAnchorElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  // badges: pending tasks on المهام + unread chat on المحادثة; refetch on route change, every 60s, and after any save (ymc:refresh)
  useEffect(() => {
    const fetchStats = () =>
      api
        .get("/stats")
        .then((s) => {
          setPending(s.my_pending ?? 0)
          setChatUnread(s.chat_unread ?? 0)
        })
        .catch(() => {})
    void fetchStats()
    const timer = window.setInterval(fetchStats, 60_000)
    window.addEventListener("ymc:refresh", fetchStats)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("ymc:refresh", fetchStats)
    }
  }, [pathname])
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  )

  const toggleDark = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle("dark", next)
    localStorage.setItem("theme", next ? "dark" : "light")
  }

  // drawer: close on route change; while open lock scroll, Escape closes, focus first item, restore on close
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    firstItem.current?.focus()
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
      trigger.current?.focus()
    }
  }, [open])

  const items = nav.filter((n) => !n.roles || n.roles.includes(user!.role))
  const page =
    nav.find((n) => (n.to === "/" ? pathname === "/" : pathname.startsWith(n.to)))
      ?.label ?? nav[0].label
  const avatar = initials(user!.name)

  return (
    <div className="flex min-h-svh overflow-x-clip">
      {open && (
        <div
          aria-hidden
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        aria-label="القائمة الرئيسية"
        className={cn(
          "fixed inset-y-0 start-0 z-40 flex w-[265px] flex-col bg-sidebar text-sidebar-foreground transition-transform duration-300 lg:translate-x-0",
          // ponytail: app is RTL-only, so "hidden" slides toward +x (off the right edge)
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex h-[65px] shrink-0 items-center gap-3 px-6">
          <Brand className="text-white" />
        </div>
        <nav className="flex-1 overflow-y-auto pt-2" aria-label="أقسام القائمة">
          {sections.map((section) => {
            const group = items.filter((n) => n.section === section)
            if (group.length === 0) return null
            return (
              <div key={section}>
                <div className="px-6 pt-4 pb-1.5 text-[11px] font-semibold tracking-wider text-sidebar-heading uppercase">
                  {section}
                </div>
                {group.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              ref={to === items[0].to ? firstItem : undefined}
              className={({ isActive }) =>
                cn(
                  "relative flex h-11 items-center gap-3 px-6 text-sm font-medium transition-colors duration-150 outline-none hover:bg-white/5 hover:text-white focus-visible:bg-white/5 focus-visible:text-white",
                  isActive &&
                    "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:bg-primary [&>svg]:text-primary",
                )
              }
            >
              <Icon className="size-5 shrink-0" />
              <span className="truncate">{label}</span>
              {to === "/tasks" && pending > 0 && (
                <span
                  aria-label={`${pending} مهام غير منجزة`}
                  className="ms-auto min-w-5 rounded-full bg-destructive px-1.5 text-center text-[10px] leading-5 font-semibold text-white"
                >
                  {pending}
                </span>
              )}
              {to === "/chat" && chatUnread > 0 && (
                <span
                  aria-label={`${chatUnread} رسائل غير مقروءة`}
                  className="ms-auto min-w-5 rounded-full bg-primary px-1.5 text-center text-[10px] leading-5 font-semibold text-white"
                >
                  {chatUnread > 99 ? "99+" : chatUnread}
                </span>
              )}
            </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="flex items-center gap-3 border-t border-sidebar-border px-6 py-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-light text-sm font-bold text-primary">
            {avatar}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">{user!.name}</div>
            <div className="text-xs">{roleLabels[user!.role]}</div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:ps-[265px]">
        <header className="sticky top-0 z-20 flex h-[65px] items-center gap-3 border-b border-secondary bg-card px-4 lg:px-8">
          <Button
            ref={trigger}
            variant="ghost"
            size="icon-lg"
            className="lg:hidden"
            aria-label="فتح القائمة"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Menu className="size-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl leading-tight font-bold">{page}</h1>
            <nav aria-label="مسار التنقل" className="text-xs text-muted-foreground">
              <Link to="/" className="hover:text-primary">
                الرئيسية
              </Link>
              <span className="mx-1">/</span>
              <span className="text-foreground">{page}</span>
            </nav>
          </div>
          <div className="ms-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label={dark ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الداكن"}
              onClick={toggleDark}
            >
              {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </Button>
            <NotificationBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-10 gap-2 px-1.5" aria-label="قائمة المستخدم">
                  <span className="flex size-8 items-center justify-center rounded-md bg-primary-light text-xs font-bold text-primary">
                    {avatar}
                  </span>
                  <span className="hidden sm:inline">{user!.name}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-light text-sm font-bold text-primary">
                    {avatar}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{user!.name}</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {roleLabels[user!.role]}
                    </span>
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/profile">
                    <UserRound />
                    الملف الشخصي
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={logout}>
                  <LogOut />
                  تسجيل الخروج
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 lg:p-8">
          <div className="mx-auto w-full max-w-[1400px]">
            <Pwa />
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
