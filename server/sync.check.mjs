// node server/sync.check.mjs — end-to-end cover for the Facebook sync write path.
// Boots the real server in-process against a throwaway DB with graph.facebook.com stubbed, then
// drives it over HTTP. smoke.js covers the no-token path; this covers what happens WITH a token,
// which is the half that actually writes to the database.
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'

const DB = join(tmpdir(), `ymc-sync-check-${process.pid}.db`)
for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true })
process.env.DB_PATH = DB
process.env.PORT = process.env.PORT || '3198'
process.env.FB_TOKEN = 'test-token'

const real = globalThis.fetch
let graph = {}
const seenCalls = []
globalThis.fetch = async (url, init) => {
  const s = String(url)
  if (!s.includes('graph.facebook.com')) return real(url, init)
  seenCalls.push(s)
  for (const [k, v] of Object.entries(graph)) if (s.includes(k)) return { ok: true, status: 200, json: async () => v }
  return { ok: true, status: 200, json: async () => ({ error: { code: 803, message: 'unknown alias' } }) }
}

await import('./src/index.js')
await new Promise((r) => setTimeout(r, 600))

const B = `http://localhost:${process.env.PORT}/api`
const call = async (m, p, t, b) => {
  const r = await real(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => null) }
}
let fails = 0
const step = (n, ok, d) => { console.log(`${n}: ${ok ? 'PASS' : 'FAIL'}`); if (!ok) { fails++; console.log('   ', JSON.stringify(d)) } }

const sup = (await call('POST', '/login', null, { username: 'super', password: 'super123' })).data.token
const g = (await call('POST', '/groups', sup, { name: 'G' })).data
await call('POST', '/users', sup, { username: 'lead', password: 'pass1234', name: 'Lead', role: 'admin', group_id: g.id })
const at = (await call('POST', '/login', null, { username: 'lead', password: 'pass1234' })).data.token
const ty = (await call('POST', '/types', at, { name: 'facebook', allows_pages: true })).data
const acc = (await call('POST', '/accounts', at, { type_id: ty.id, name: 'News', mobile: '0590000001', link: 'https://facebook.com/YMCNews', posts_count: 800, shares: 100 })).data
const pg = (await call('POST', `/accounts/${acc.id}/pages`, at, { name: 'Sports', url: 'https://facebook.com/YMCSports' })).data

const now = Date.now()
const post = (id, ms, sh, rx, cm) => ({ id, created_time: new Date(ms).toISOString(), ...(sh ? { shares: { count: sh } } : {}), reactions: { summary: { total_count: rx } }, comments: { summary: { total_count: cm } } })

graph = { 'me?': { name: 'YMC System User' } }
const h = await call('GET', '/sync/health', at)
step('health reports connected with a token', h.status === 200 && h.data.connected === true, h.data)

graph = {
  'YMCNews/published_posts': { data: [post('n1', now, 5, 10, 2), post('n2', now - 3 * 864e5, 0, 4, 1)] },
  'YMCNews?': { name: 'News', followers_count: 5000 },
  'YMCSports/published_posts': { data: [post('s1', now, 2, 6, 1)] },
  'YMCSports?': { name: 'Sports FC', followers_count: 900 },
}
const s1 = await call('POST', `/accounts/${acc.id}/sync`, at, {})
step('sync returns the account row + per-page results',
  s1.status === 200 && s1.data.account_error === null && s1.data.pages.length === 1 && s1.data.pages[0].ok === true, s1.data)
step('followers overwritten, posts/shares ACCUMULATED onto the hand-entered totals',
  s1.data.account.followers === 5000 && s1.data.account.posts_count === 802 && s1.data.account.shares === 105
  && s1.data.account.reactions === 14 && s1.data.account.comments === 3, s1.data.account)
step('posts_today counts only today, last_checked_at stamped',
  s1.data.account.posts_today === 1 && !!s1.data.account.last_checked_at, s1.data.account)

const ev1 = (await call('GET', `/accounts/${acc.id}/events`, at)).data
step('a metrics event carries via:sync and every tracked number',
  ev1.some((e) => e.kind === 'metrics' && e.data?.via === 'sync' && e.data.shares === 105 && e.data.followers === 5000), ev1.slice(0, 3))
step('a live name differing from the label is REPORTED, not auto-renamed',
  ev1.some((e) => e.kind === 'updated' && /Sports FC/.test(e.summary)) && s1.data.account.name === 'News',
  ev1.filter((e) => e.kind === 'updated').map((e) => e.summary))

graph['YMCNews/published_posts'] = { data: [post('n1', now, 9, 10, 2), post('n3', now, 1, 0, 0)] }
const s2 = await call('POST', `/accounts/${acc.id}/sync`, at, {})
step('second sync adds only the delta (+1 post, +5 shares)',
  s2.data.account.posts_count === 803 && s2.data.account.shares === 110, s2.data.account)

const s3 = await call('POST', `/accounts/${acc.id}/sync`, at, {})
const ev3 = (await call('GET', `/accounts/${acc.id}/events`, at)).data
step('an empty sync logs `checked`, never a fake metrics event',
  s3.data.account.posts_count === 803 && ev3[0].kind === 'checked' && /مزامنة/.test(ev3[0].summary), ev3[0])
step('the name-mismatch notice is logged ONCE, not on every sync',
  ev3.filter((e) => /يختلف عن الاسم المسجّل/.test(e.summary)).length === 1,
  ev3.filter((e) => /يختلف/.test(e.summary)).map((e) => e.summary))

graph = { 'YMCNews?': { error: { code: 190, message: 'expired' } }, 'YMCSports?': { name: 'Sports FC', followers_count: 900 }, 'YMCSports/published_posts': { data: [] } }
const s4 = await call('POST', `/accounts/${acc.id}/sync`, at, {})
step('an expired token reports per-row and leaves status alone',
  s4.status === 200 && /انتهت صلاحية/.test(s4.data.account_error) && s4.data.account.status === 'active', s4.data)

graph = { 'YMCNews?': { error: { code: 803, message: 'unknown alias' } } }
const s5 = await call('POST', `/accounts/${acc.id}/sync`, at, {})
step('a vanished page (803) closes the account', s5.data.account.status === 'closed', s5.data)

const prof = (await call('POST', '/accounts', at, { type_id: ty.id, name: 'Personal', mobile: '0590000009', link: 'https://facebook.com/profile.php?id=100012345678901' })).data
const before = seenCalls.length
const s6 = await call('POST', `/accounts/${prof.id}/sync`, at, {})
step('a personal-profile link 400s WITHOUT touching Graph',
  s6.status === 400 && /حساب شخصي/.test(s6.data.error) && seenCalls.length === before, [s6.data, seenCalls.length - before])

graph = { 'YMCSports?': { name: 'Sports FC', followers_count: 900 }, 'YMCSports/published_posts': { data: [] } }
// the common real shape: the account's own link is a personal profile, but it owns a real Page.
// The account reports `account_skipped` (not a plain failure) and the page still syncs.
const own = (await call('POST', '/accounts', at, { type_id: ty.id, name: 'Owner', mobile: '0590000010', link: 'https://facebook.com/profile.php?id=100099' })).data
const ownPg = (await call('POST', `/accounts/${own.id}/pages`, at, { name: 'Shop', url: 'https://facebook.com/YMCShop' })).data
graph = { 'YMCShop?': { name: 'Shop', followers_count: 77 }, 'YMCShop/published_posts': { data: [post('x1', now, 0, 3, 0)] } }
const s7 = await call('POST', `/accounts/${own.id}/sync`, at, {})
step('a profile account with a real Page: skipped, not failed — and the page syncs',
  s7.status === 200 && s7.data.account_skipped === true && /حساب شخصي/.test(s7.data.account_error)
  && s7.data.pages.length === 1 && s7.data.pages[0].ok === true, s7.data)
step('a Graph failure is never marked skipped', s4.data.account_skipped === false, s4.data.account_skipped)

// REGRESSION: posts_today belongs to the sync that computed it. quickUpdate always re-stamps
// last_checked_at — which is what the UI gates the «اليوم N» badge on — so a manual check the next
// morning would otherwise relabel yesterday's count as today's.
graph = { 'YMCNews?': { name: 'News', followers_count: 6000 }, 'YMCNews/published_posts': { data: [post('t1', now, 0, 1, 0)] } }
await call('PUT', `/accounts/${acc.id}`, at, { status: 'active' })          // reopen the 803-closed row
const sA = await call('POST', `/accounts/${acc.id}/sync`, at, {})
step('a sync sets posts_today', sA.data.account.posts_today === 1, sA.data.account.posts_today)
const sB = await call('POST', `/accounts/${acc.id}/updates`, at, { followers: 6100 })
step('a MANUAL check clears posts_today instead of reviving it as today\'s count',
  sB.data.posts_today === null && !!sB.data.last_checked_at, sB.data)
const sC = await call('POST', `/accounts/${acc.id}/updates`, at, {})        // an empty "I checked it" save
step('even an empty manual check clears it', sC.data.posts_today === null, sC.data.posts_today)

graph = { 'YMCSports?': { name: 'Sports FC', followers_count: 900 }, 'YMCSports/published_posts': { data: [] } }
const p1 = await call('POST', `/pages/${pg.id}/sync`, at, {})
step('a page syncs on its own', p1.status === 200 && p1.data.followers === 900, p1.data)

for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true })
console.log(fails ? `\n${fails} FAILURES` : '\nsync.check: all end-to-end checks passed')
process.exit(fails ? 1 : 0)
