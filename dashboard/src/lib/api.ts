export const BASE = import.meta.env.VITE_API_URL ?? ""
export const getToken = () => localStorage.getItem("token")

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("token")
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function fail(res: Response): Promise<never> {
  const body = await res.json().catch(() => null)
  throw new Error(body?.error ?? "حدث خطأ غير متوقع")
}

// fetch throws a bare TypeError("Failed to fetch") when offline — surface it in Arabic like every other error
const net = (url: string, init?: RequestInit) =>
  fetch(url, init).catch(() => {
    throw new Error("تعذر الاتصال بالخادم — تحقق من اتصالك بالإنترنت")
  })

async function request(path: string, init: RequestInit = {}): Promise<any> {
  // FormData sets its own multipart boundary — never force a JSON content-type on it
  const json = !(init.body instanceof FormData)
  const res = await net(`${BASE}/api${path}`, {
    ...init,
    headers: { ...(json ? { "Content-Type": "application/json" } : {}), ...authHeaders() },
  })
  if (res.status === 401 && path !== "/login") {
    localStorage.removeItem("token")
    localStorage.removeItem("user")
    window.location.href = "/login"
    throw new Error("انتهت الجلسة، يرجى تسجيل الدخول مجددًا")
  }
  if (!res.ok) await fail(res)
  return res.json()
}

export const api = {
  get: (path: string) => request(path),
  post: (path: string, body?: unknown) =>
    request(path, { method: "POST", body: JSON.stringify(body) }),
  put: (path: string, body?: unknown) =>
    request(path, { method: "PUT", body: JSON.stringify(body) }),
  del: (path: string) => request(path, { method: "DELETE" }),
  upload: (path: string, form: FormData) => request(path, { method: "POST", body: form }),
  download: async (path: string) => {
    const res = await net(`${BASE}/api${path}`, { headers: authHeaders() })
    if (!res.ok) await fail(res)
    const name =
      res.headers.get("Content-Disposition")?.match(/filename="?([^"]+?)"?$/)?.[1] ??
      "report.xlsx"
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement("a")
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  },
}
