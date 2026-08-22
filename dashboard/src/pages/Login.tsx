import { useState, type FormEvent } from "react"
import { Navigate, useNavigate } from "react-router-dom"
import { LogoMark, Wordmark } from "@/components/Logo"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/lib/auth"

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError("")
    setBusy(true)
    try {
      await login(username, password)
      navigate("/", { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر تسجيل الدخول")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh bg-background">
      <aside className="hidden w-1/2 flex-col justify-center gap-5 bg-linear-to-br from-primary to-info p-16 text-white lg:flex">
        <LogoMark tone="light" className="size-16 shadow-lg shadow-black/20" />
        <h2 className="text-3xl"><Wordmark /></h2>
        <p className="text-lg text-white/80">
          نظام متابعة أعمال الفرق على منصات التواصل
        </p>
      </aside>
      <div className="flex flex-1 items-center justify-center p-4 sm:p-8">
        <Card className="w-full max-w-sm">
          <CardContent className="space-y-6 p-6 sm:p-8">
            <div className="flex flex-col items-center gap-3 text-center">
              <LogoMark className="size-14" />
              <h1 className="text-xl font-bold">تسجيل الدخول</h1>
              <p className="text-sm text-muted-foreground">
                أدخل بياناتك للوصول إلى YMCReport
              </p>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">اسم المستخدم</Label>
                <Input
                  id="username"
                  className="h-11"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">كلمة المرور</Label>
                <Input
                  id="password"
                  type="password"
                  className="h-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy ? "جارٍ تسجيل الدخول…" : "تسجيل الدخول"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
