// SQLite datetime('now') → "YYYY-MM-DD HH:MM:SS" in UTC
export const toDate = (s: string) => new Date(/[TZ]/.test(s) ? s : s.replace(" ", "T") + "Z")
export const minutesSince = (s: string) => Math.floor((Date.now() - toDate(s).getTime()) / 60000)
export const daysSince = (s: string) => Math.floor((Date.now() - toDate(s).getTime()) / 86400000)

export const relDays = (s: string) => {
  const d = daysSince(s)
  if (d <= 0) return "اليوم"
  if (d === 1) return "أمس"
  if (d === 2) return "منذ يومين"
  return d <= 10 ? `منذ ${d} أيام` : `منذ ${d} يومًا`
}
export const relTime = (s: string) => {
  const m = minutesSince(s)
  if (m < 1) return "الآن"
  if (m < 60) return `منذ ${m} دقيقة`
  const h = Math.floor(m / 60)
  return h < 24 ? `منذ ${h} ساعة` : relDays(s)
}
export const fullDate = (s: string) => toDate(s).toLocaleString("en-GB", { hour12: false })
