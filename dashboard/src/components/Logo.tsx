import { useId } from "react"
import { cn } from "@/lib/utils"

// Brand mark: a "Y" monogram whose stem is the tallest bar of a mini bar-chart (YMC + Report).
export function LogoMark({
  className = "size-9",
  tone = "brand",
}: {
  className?: string
  tone?: "brand" | "light"
}) {
  const id = useId()
  const light = tone === "light"
  const ink = light ? "#1E40AF" : "#fff"
  return (
    <svg viewBox="0 0 64 64" className={cn("shrink-0", className)} role="img" aria-label="شعار YMCReport">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#1E40AF" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={light ? "#fff" : `url(#${id})`} />
      <path d="M19 17 L32 31 M45 17 L32 31" stroke={ink} strokeWidth="7" strokeLinecap="round" fill="none" />
      <rect x="28.5" y="29" width="7" height="21" rx="3.5" fill={ink} />
      <rect x="17" y="38" width="7" height="12" rx="3.5" fill={ink} opacity=".9" />
      <rect x="40" y="34" width="7" height="16" rx="3.5" fill={ink} opacity=".9" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span dir="ltr" className={cn("font-bold leading-none tracking-tight", className)}>
      YMC<span className="font-medium opacity-80">Report</span>
    </span>
  )
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <LogoMark className="size-9" />
      <Wordmark className="text-lg" />
    </span>
  )
}
