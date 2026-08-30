import { initializeApp } from "firebase/app"
import { getMessaging, getToken, isSupported } from "firebase/messaging"
import { api } from "./api"

// Web Firebase config is public by design; the VAPID key comes from
// Firebase console → Project settings → Cloud Messaging → Web Push certificates (env VITE_FIREBASE_VAPID_KEY).
const app = initializeApp({
  apiKey: "AIzaSyDdSYckz9FO4qtWAaHSlXyI1765-V_UyUU",
  authDomain: "ymc-team.firebaseapp.com",
  projectId: "ymc-team",
  storageBucket: "ymc-team.firebasestorage.app",
  messagingSenderId: "545044732373",
  appId: "1:545044732373:web:901d75ac63a9ae02df855c",
})
const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined
const KEY = "pushToken"

export type PushState = "unsupported" | NotificationPermission
export const pushState = (): PushState =>
  !vapidKey || !("Notification" in window) || !("serviceWorker" in navigator) ? "unsupported" : Notification.permission

// token from the PWA's own service worker (push-sw.js handles the `push` event — no firebase-messaging-sw.js)
async function register(timeoutMs = 8000) {
  if (!(await isSupported())) throw new Error("المتصفح لا يدعم التنبيهات")
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("خدمة التطبيق غير جاهزة بعد — أعد المحاولة")), timeoutMs)),
  ])
  const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: reg })
  await api.post("/push/token", { token })
  localStorage.setItem(KEY, token)
}

// register() is not concurrency-safe (StrictMode double-mount → two parallel getToken calls
// can both fail on a fresh profile) — serialize through one in-flight promise
let inflight: Promise<void> | null = null
const registerOnce = (timeoutMs?: number) => (inflight ??= register(timeoutMs).finally(() => { inflight = null }))

// on app load: keeps the server's copy current while permission is granted (tokens rotate)
export const syncPush = () => {
  if (pushState() !== "granted") return
  registerOnce().catch((e) => {
    console.warn("push sync:", e) // silent path — leave a breadcrumb, then retry once
    setTimeout(() => { if (pushState() === "granted") registerOnce().catch(() => {}) }, 3000)
  })
}

// user gesture → permission prompt → register; false when the user declined
export async function enablePush() {
  if ((await Notification.requestPermission()) !== "granted") return false
  await registerOnce(30000) // user gesture: wait out a slow first-time SW install instead of dead-ending
  return true
}

// granted permission but no server binding (register() failed after the grant) → offer retry UI
export const needsRegister = () => pushState() === "granted" && !localStorage.getItem(KEY)

// logout: unbind this device so the next account on it doesn't receive these pushes
export function forgetPush() {
  const token = localStorage.getItem(KEY)
  localStorage.removeItem(KEY)
  if (token) api.del(`/push/token?token=${encodeURIComponent(token)}`).catch(() => {})
  // local unsubscribe is authoritative: even if the DELETE fails (expired JWT, offline),
  // delivery to this device stops; the dead endpoint then 404s and the server purges its row
  navigator.serviceWorker
    ?.getRegistration()
    .then((r) => r?.pushManager.getSubscription())
    .then((s) => void s?.unsubscribe())
    .catch(() => {})
}
