import { useEffect, useState } from "react"
import { useRegisterSW } from "virtual:pwa-register/react"
import { Download, Share, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { LogoMark } from "@/components/Logo"

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

const DISMISS_KEY = "pwa-install-dismissed"
const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

// Service-worker lifecycle toasts + install banner (Android/desktop prompt, iOS share-sheet hint).
export function Pwa() {
  const { needRefresh: [needRefresh], offlineReady: [offlineReady], updateServiceWorker } = useRegisterSW()
  const [install, setInstall] = useState<InstallEvent | null>(null)
  const [hidden, setHidden] = useState(() => standalone() || localStorage.getItem(DISMISS_KEY) === "1")

  useEffect(() => {
    if (needRefresh)
      toast("يتوفر إصدار جديد من التطبيق", {
        duration: Infinity,
        action: { label: "تحديث الآن", onClick: () => void updateServiceWorker(true) },
      })
  }, [needRefresh, updateServiceWorker])

  useEffect(() => {
    if (offlineReady) toast.success("التطبيق جاهز للعمل دون اتصال")
  }, [offlineReady])

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstall(e as InstallEvent) }
    const off = () => toast.warning("أنت غير متصل بالإنترنت — ستظهر البيانات عند عودة الاتصال", { id: "net" })
    const on = () => toast.success("عاد الاتصال بالإنترنت", { id: "net" })
    window.addEventListener("beforeinstallprompt", onPrompt)
    window.addEventListener("appinstalled", () => setHidden(true))
    window.addEventListener("offline", off)
    window.addEventListener("online", on)
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt)
      window.removeEventListener("offline", off)
      window.removeEventListener("online", on)
    }
  }, [])

  const ios = isIOS()
  if (hidden || (!install && !ios)) return null

  const dismiss = () => { localStorage.setItem(DISMISS_KEY, "1"); setHidden(true) }
  const doInstall = async () => {
    if (!install) return
    await install.prompt()
    if ((await install.userChoice).outcome === "accepted") setHidden(true)
  }

  return (
    <div role="region" aria-label="تثبيت التطبيق" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-primary/20 bg-primary-light px-4 py-3 text-sm">
      <LogoMark className="size-9" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">ثبّت YMCReport على هاتفك</p>
        <p className="text-muted-foreground">
          {install ? "يعمل كتطبيق مستقل، أسرع، ويفتح من الشاشة الرئيسية." : (
            <>من Safari: اضغط <Share className="inline size-4 align-text-bottom" aria-label="مشاركة" /> ثم «إضافة إلى الشاشة الرئيسية».</>
          )}
        </p>
      </div>
      {install && (
        <Button onClick={doInstall} className="w-full sm:w-auto">
          <Download /> تثبيت
        </Button>
      )}
      <Button variant="ghost" size="icon-lg" aria-label="إخفاء" onClick={dismiss}>
        <X />
      </Button>
    </div>
  )
}
