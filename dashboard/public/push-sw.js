// Imported into the generated workbox SW (vite.config → workbox.importScripts).
// Handles data-only FCM messages sent by server/src/push.js: { title, body, link, kind, key }.
self.addEventListener('push', (e) => {
  const d = ((e.data && e.data.json()) || {}).data || {}
  if (!d.title) return
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    wins.forEach((w) => w.postMessage({ type: 'push' })) // open tabs refetch + toast in-app
    if (wins.some((w) => w.visibilityState === 'visible')) return // app on screen → no OS notification
    await self.registration.showNotification(d.title, {
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
