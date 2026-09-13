import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Normalizes a stored link for an href. The link/url columns (sites, accounts, pages, subtasks) are
// free text — nothing validates a scheme, client or server — so a bare "instagram.com/x" would resolve
// against OUR origin and, via workbox navigateFallback, serve the app shell instead of the site.
// ponytail: URL does the parsing, not a regex — "example.com:8080/admin" reads as scheme "example.com:"
// to a hand-rolled one and becomes https://8080 (a valid IPv4!). The allow-list also neuters
// javascript:/data: instead of letting them through.
// Ceiling: render-time only, existing rows keep whatever was typed. Upgrade path: normalize on write in
// server/src/routes/{accounts,meta,tasks}.js if malformed rows keep arriving.
const parse = (s: string) => {
  try {
    return /^(https?|mailto|tel):$/.test(new URL(s).protocol) ? s : null
  } catch {
    return null
  }
}
export const ext = (u?: string | null) => {
  // bidi marks ride along on URLs pasted from RTL text and make the whole thing unparseable
  const s = (u ?? "").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim()
  return /^\/[^/]/.test(s) ? s : (parse(s) ?? parse(`https://${s.replace(/^\/+/, "")}`) ?? "")
}
