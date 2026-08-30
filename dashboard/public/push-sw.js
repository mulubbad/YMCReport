// Imported into the generated workbox SW (vite.config → workbox.importScripts).
// 1) FCM push handling — data-only messages from server/src/push.js: { title, body, link, kind, key, unread }.
// 2) Offline mutation queue — API writes that fail by NETWORK error queue here and replay in order
//    on: browser 'sync' (reconnect), ANY incoming push, or a {type:'flush'} page message.
//    ponytail: hand-rolled (~40 lines) because workbox-background-sync can't be re-triggered on
//    demand — a sync tag that already failed sits in Chrome's ~5min retry backoff, so a push
//    could not flush it. Single queue also keeps POST→PUT order, which per-method queues lose.

const isWebKit = /AppleWebKit/i.test(self.navigator.userAgent) && !/Chrome|Chromium|Edg|Android/i.test(self.navigator.userAgent)

// --- offline queue (IndexedDB: ymc-offline-queue/q, autoIncrement keys = FIFO)
const idb = () => new Promise((res, rej) => {
  const o = indexedDB.open('ymc-offline-queue', 1)
  o.onupgradeneeded = () => o.result.createObjectStore('q', { autoIncrement: true })
  o.onsuccess = () => res(o.result)
  o.onerror = () => rej(o.error)
})
const qAdd = async (entry) => {
  const db = await idb()
  await new Promise((res, rej) => {
    const t = db.transaction('q', 'readwrite')
    t.objectStore('q').add(entry)
    t.oncomplete = res
    t.onerror = () => rej(t.error)
  })
}
let flushing = false
async function flushQueue() {
  if (flushing) return
  flushing = true
  try {
    const db = await idb()
    for (;;) {
      const head = await new Promise((res) => {
        const c = db.transaction('q').objectStore('q').openCursor()
        c.onsuccess = () => res(c.result ? { key: c.result.key, e: c.result.value } : null)
        c.onerror = () => res(null)
      })
      if (!head) break
      try { await fetch(head.e.url, { method: head.e.method, headers: head.e.headers, body: head.e.body || undefined }) }
      catch { break } // still unreachable — keep the queue, retry on the next trigger
      await new Promise((res, rej) => {
        const t = db.transaction('q', 'readwrite')
        t.objectStore('q').delete(head.key)
        t.oncomplete = res
        t.onerror = () => rej(t.error)
      })
    }
  } finally { flushing = false }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (!['POST', 'PUT', 'DELETE'].includes(e.request.method)) return
  if (!url.pathname.startsWith('/api/') || url.pathname === '/api/login') return
  const queued = e.request.clone()
  e.respondWith((async () => {
    try { return await fetch(e.request) }
    catch (err) {
      // network failure (not 4xx/5xx): queue for replay; the page still sees the error (offline toast)
      await qAdd({ url: queued.url, method: queued.method, headers: [...queued.headers], body: await queued.arrayBuffer(), ts: Date.now() })
      if (self.registration.sync) self.registration.sync.register('ymc-flush').catch(() => {})
      throw err
    }
  })())
})
self.addEventListener('sync', (e) => { if (e.tag === 'ymc-flush') e.waitUntil(flushQueue()) })
self.addEventListener('message', (e) => { if (e.data && e.data.type === 'flush') flushQueue() })

// --- push: flush queue, sync app badge, notify open tabs, show OS notification.
// WebKit (Safari/iOS PWA) revokes the subscription after ~3 pushes without showNotification and
// has no visible-client exemption — so only Chromium suppresses the OS notification when a tab is visible.
self.addEventListener('push', (e) => {
  let d = {}
  try { d = ((e.data && e.data.json()) || {}).data || {} } catch { /* non-JSON push */ }
  e.waitUntil((async () => {
    await flushQueue() // a push proves connectivity — push out anything queued offline
    if (self.navigator.setAppBadge && d.unread !== undefined)
      await self.navigator.setAppBadge(Number(d.unread) || 0).catch(() => {})
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    wins.forEach((w) => w.postMessage({ type: 'push' })) // open tabs refetch + toast in-app
    if (!isWebKit && wins.some((w) => w.visibilityState === 'visible')) return
    await self.registration.showNotification(d.title || 'YMCReport', {
      body: d.body || undefined, icon: '/icon-192.png', lang: 'ar', dir: 'rtl',
      tag: d.key, data: { link: d.link || '/' },
    })
  })())
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const link = (e.notification.data && e.notification.data.link) || '/'
  e.waitUntil((async () => {
    const [w] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (w) { await w.focus(); w.postMessage({ type: 'navigate', link }) }
    else await self.clients.openWindow(link)
  })())
})
