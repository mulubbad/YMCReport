// Update cadence presets for an account type: 0 = never due, N = "at least once every N days".
// Mirrors UPDATE_DAYS_AR in server/src/routes/meta.js — the two lists change together.
export const CADENCE: { value: number; label: string }[] = [
  { value: 1, label: "يومياً" },
  { value: 2, label: "كل يومين" },
  { value: 3, label: "كل 3 أيام" },
  { value: 7, label: "أسبوعياً" },
  { value: 14, label: "كل أسبوعين" },
  { value: 30, label: "شهرياً" },
  { value: 0, label: "بدون تحديث دوري" },
]

// the server accepts any integer 0..365, so a value set outside the presets still needs a label
export const cadenceLabel = (n: number) => CADENCE.find((c) => c.value === n)?.label ?? `كل ${n} يوم`
