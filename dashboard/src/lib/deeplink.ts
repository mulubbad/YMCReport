import { useEffect } from "react"
import { useSearchParams } from "react-router-dom"

// Opens whatever a notification pointed at (?task=12, ?account=5&tab=notes, ?sim=3 …) once the page's
// own data is loaded, then strips those params so a refresh or Back doesn't reopen the dialog.
// Clicking a second notification for the same page re-fires: the params change again after clearing.
export function useDeepLink(keys: string[], ready: boolean, apply: (p: URLSearchParams) => void) {
  const [params, setParams] = useSearchParams()
  const hit = keys.map((k) => params.get(k) ?? "").join("|")

  useEffect(() => {
    if (!ready || !hit.replace(/\|/g, "")) return
    apply(params)
    const rest = new URLSearchParams(params)
    keys.forEach((k) => rest.delete(k))
    setParams(rest, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hit])
}
