// Guards ext(): a stored link must never resolve against our own origin (the app shell would load
// instead of the site) and must never carry an executable scheme.
// run: cd dashboard && npx jiti src/lib/utils.check.ts
import { ext } from "./utils"

let bad = 0
const eq = (got: string, want: string, why: string) => {
  if (got !== want) { bad++; console.error(`FAIL ${why}: ${JSON.stringify(got)} !== ${JSON.stringify(want)}`) }
}
eq(ext("instagram.com/ymc"), "https://instagram.com/ymc", "bare host must get a scheme")
eq(ext("example.com:8080/a"), "https://example.com:8080/a", "host:port is not a scheme")
eq(ext("  https://x.com/a  "), "https://x.com/a", "absolute url kept")
eq(ext("‏instagram.com/y"), "https://instagram.com/y", "RTL mark stripped")
eq(ext("mailto:a@b.c"), "mailto:a@b.c", "mailto kept")
eq(ext("/tasks"), "/tasks", "in-app path kept")
eq(ext("   "), "", "blank stays blank")
for (const d of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>x</script>", "vbscript:msgbox(1)"])
  if (/^\s*(javascript|data|vbscript):/i.test(ext(d))) { bad++; console.error(`FAIL executable scheme survived: ${d}`) }

if (bad) throw new Error(`${bad} failures`)
console.log("ext ok")
