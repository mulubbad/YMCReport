const express = require('express');
const db = require('../db');
const { auth, resolveOwner, scopeGid, canManage } = require('../auth');
const { notify, groupAdmins, day } = require('../notify');
const fb = require('../fb');

const r = express.Router();
r.use(auth);

const STATUSES = ['active', 'restricted', 'suspended', 'closed'];
const STATUS_AR = { active: 'نشط', restricted: 'مقيّد', suspended: 'موقوف', closed: 'مغلق' };
const EVENT_AR = {
  created: 'إنشاء', updated: 'تعديل', status: 'تغيير الحالة', metrics: 'تحديث الإحصائيات', note: 'ملاحظة',
  page_created: 'إضافة صفحة', page_updated: 'تعديل صفحة', page_deleted: 'حذف صفحة', checked: 'فحص',
};
const LABEL_AR = {
  type_id: 'نوع الحساب', site_id: 'الموقع', name: 'الاسم', mobile: 'رقم الجوال', email: 'البريد الإلكتروني',
  password: 'كلمة المرور', link: 'الرابط', profile_address: 'المنطقة الجغرافية للحساب', profile_work: 'طبيعة عمل صاحب الحساب',
  notes: 'ملاحظات', url: 'الرابط', address: 'العنوان', work: 'العمل', note: 'ملاحظات',
  status: 'الحالة', followers: 'المتابعون', posts_count: 'عدد المنشورات',
  shares: 'المشاركات', reactions: 'التفاعلات', comments: 'التعليقات', posts_today: 'منشورات اليوم',
};

const TRACK = ['status', 'followers', 'posts_count', 'shares', 'reactions', 'comments'];
// every TRACK field except status: the numbers a `metrics` event carries, in one place so adding a
// column can never persist a value while logging no history (that bug is silent).
const METRICS = TRACK.filter((f) => f !== 'status');
const FIELDS = ['type_id', 'site_id', 'name', 'mobile', 'email', 'password', 'link', 'profile_address', 'profile_work', 'notes', ...TRACK];
const PAGE_FIELDS = ['name', 'url', 'address', 'work', 'note', ...TRACK];

// prev_followers: the metrics snapshot before the latest one (account-level events only)
const ACCOUNT_SQL = `
  SELECT a.*, t.name AS type_name, t.allows_pages, s.name AS site_name, u.name AS owner_name,
         u.group_id AS owner_group,
         (SELECT COUNT(*) FROM pages p WHERE p.account_id = a.id) AS page_count,
         (SELECT COUNT(*) FROM entity_notes n WHERE n.entity_type = 'account' AND n.entity_id = a.id) AS note_count,
         (SELECT json_extract(e.data, '$.followers') FROM account_events e
          WHERE e.account_id = a.id AND e.kind = 'metrics' AND e.page_id IS NULL
          ORDER BY e.id DESC LIMIT 1 OFFSET 1) AS prev_followers
  FROM accounts a
  JOIN users u ON u.id = a.user_id
  JOIN account_types t ON t.id = a.type_id
  LEFT JOIN sites s ON s.id = a.site_id`;

const getAccount = (id) => db.prepare(`${ACCOUNT_SQL} WHERE a.id = ?`).get(id);
const getPageRow = (id) => db.prepare('SELECT * FROM pages WHERE id = ?').get(id);

const canAccess = (me, acc) =>
  me.role === 'super' ||
  (me.role === 'admin' ? canManage(me, acc.owner_group) : acc.user_id === me.id);

const FORBIDDEN = { error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' };

// Arabic error for invalid tracking fields, null when fine
function trackError(b) {
  if (b.status != null && !STATUSES.includes(b.status)) return 'الحالة غير صالحة';
  for (const f of METRICS)
    if (b[f] != null && !(Number.isInteger(b[f]) && b[f] >= 0)) return `${LABEL_AR[f]}: يجب أن تكون عددًا صحيحًا غير سالب`;
  return null;
}

// body over base row; status never null
const merge = (fields, base, b) => Object.fromEntries(fields.map((f) =>
  [f, f === 'status' ? (b.status ?? base.status ?? 'active') : ((f in b ? b[f] : base[f]) ?? null)]));

const logEvent = ({ account_id, page_id = null, user_id, kind, summary, data = null }) =>
  db.prepare('INSERT INTO account_events (account_id, page_id, user_id, kind, summary, data) VALUES (?,?,?,?,?,?)')
    .run(account_id, page_id, user_id, kind, summary, data == null ? null : JSON.stringify(data));

const metricsSummary = (row) => 'تحديث الإحصائيات: ' +
  METRICS.filter((f) => row[f] != null).map((f) => `${LABEL_AR[f]} ${row[f]}`).join('، ');

// diff before→after over fields; logs updated/status/metrics events (metrics also stamps last_checked_at).
// Returns number of events logged.
function logDiff({ account_id, page_id = null, page_name, user_id, before, after, fields, via = null }) {
  const changed = fields.filter((f) => (after[f] ?? null) !== (before[f] ?? null));
  const diff = (keys) => Object.fromEntries(keys.filter((f) => f !== 'password') // never echo password values
    .map((f) => [f, { from: before[f] ?? null, to: after[f] ?? null }]));
  const prefix = page_id ? `صفحة «${page_name}»: ` : '';
  let n = 0;
  const log = (kind, summary, data) => { logEvent({ account_id, page_id, user_id, kind, summary: prefix + summary, data }); n++; };
  const general = changed.filter((f) => !TRACK.includes(f));
  if (general.length) log(page_id ? 'page_updated' : 'updated', 'تم تعديل: ' + general.map((f) => LABEL_AR[f]).join('، '), diff(general));
  if (changed.includes('status')) {
    log('status', `تغيير الحالة من ${STATUS_AR[before.status]} إلى ${STATUS_AR[after.status]}`, diff(['status']));
    if (!page_id && after.status !== 'active') { // account went inactive -> group admins (except actor) + owner
      const acc = db.prepare('SELECT a.name, a.user_id, u.group_id FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.id = ?').get(account_id);
      const to = groupAdmins(acc.group_id, user_id);
      if (acc.user_id !== user_id) to.push(acc.user_id);
      notify(to, { key: `account:${account_id}:status:${after.status}:${day()}`, kind: 'account_status',
        title: `تغيّرت حالة الحساب: ${acc.name}`, body: `الحالة الجديدة: ${STATUS_AR[after.status]}`, link: `/accounts?account=${account_id}` }, user_id);
    }
  }
  if (changed.some((f) => METRICS.includes(f))) {
    // `via:'sync'` is the provenance stamp — there is no last_synced_at column, a sync IS a check
    // performed by a robot. prev_followers' json_extract($.followers) keeps working: the key stays.
    log('metrics', metricsSummary(after), {
      ...Object.fromEntries(METRICS.map((f) => [f, after[f] ?? null])),
      ...(via ? { via } : null),
    });
    db.prepare(`UPDATE ${page_id ? 'pages' : 'accounts'} SET last_checked_at = datetime('now') WHERE id = ?`).run(page_id ?? account_id);
  }
  return n;
}

// quick update {followers?, posts_count?, status?, note?}: returns Arabic error or null
function quickUpdate({ table, row, account_id, page_id = null, page_name, user_id, body, via = null }) {
  const b = Object.fromEntries(Object.entries(body || {}).filter(([, v]) => v != null && v !== ''));
  const err = trackError(b);
  if (err) return err;
  const after = merge(TRACK, row, b);
  const prefix = page_id ? `صفحة «${page_name}»: ` : '';
  let n = logDiff({ account_id, page_id, page_name, user_id, before: row, after, fields: TRACK, via });
  if (b.note) { logEvent({ account_id, page_id, user_id, kind: 'note', summary: prefix + String(b.note).trim() }); n++; }
  if (!n) {
    const what = page_id ? `الصفحة «${page_name}»` : 'الحساب';
    logEvent({ account_id, page_id, user_id, kind: 'checked',
      summary: via === 'sync' ? `تمت مزامنة ${what} من فيسبوك — لا جديد` : `تم فحص ${what}` });
  }
  // Built from TRACK, not hardcoded: a new column that the events say changed must actually persist.
  // posts_today is cleared because it belongs to the sync that computed it — this UPDATE always
  // re-stamps last_checked_at, which is exactly what the UI gates the «اليوم N» badge on, so a manual
  // «تحديث سريع» the next morning would otherwise relabel yesterday's count as today's. A successful
  // sync rewrites it immediately after; a failed one (803 -> مغلق) rightly leaves it null.
  db.prepare(`UPDATE ${table} SET ${TRACK.map((f) => `${f} = ?`).join(', ')},
      last_checked_at = datetime('now'), posts_today = NULL WHERE id = ?`)
    .run(...TRACK.map((f) => after[f]), row.id);
  return null;
}

r.get('/accounts', (req, res) => {
  const me = req.user;
  const where = [], args = [];
  if (me.role === 'user') { where.push('a.user_id = ?'); args.push(me.id); }
  else {
    const gid = scopeGid(req, res);           // admin: the active group; super: ?group_id or all
    if (gid === false) return;
    if (me.role === 'admin' && !gid) return res.json([]);
    if (gid) { where.push('u.group_id = ?'); args.push(gid); }
    if (req.query.user_id) { where.push('a.user_id = ?'); args.push(req.query.user_id); }
  }
  const sql = `${ACCOUNT_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.created_at DESC`;
  res.json(db.prepare(sql).all(...args));
});

r.post('/accounts', (req, res) => {
  const b = req.body || {};
  const me = req.user;
  const owner = b.user_id ? resolveOwner(me, b.user_id, res) : { id: me.id, group_id: me.group_id };
  if (!owner) return;
  if (!b.name || !b.type_id) return res.status(400).json({ error: 'الاسم ونوع الحساب حقلان مطلوبان' });
  if (!b.mobile && !b.email) return res.status(400).json({ error: 'يجب إدخال رقم الجوال أو البريد الإلكتروني' });
  const err = trackError(b);
  if (err) return res.status(400).json({ error: err });
  const type = db.prepare('SELECT * FROM account_types WHERE id = ?').get(b.type_id);
  if (!type || type.group_id !== owner.group_id) return res.status(400).json({ error: 'نوع الحساب لا يتبع مجموعة مالك الحساب' });
  const v = merge(FIELDS, {}, b);
  const id = db.prepare(`INSERT INTO accounts (user_id, ${FIELDS.join(', ')}) VALUES (?${',?'.repeat(FIELDS.length)})`)
    .run(owner.id, ...FIELDS.map((f) => v[f])).lastInsertRowid;
  logEvent({ account_id: id, user_id: me.id, kind: 'created', summary: `تم إنشاء الحساب «${v.name}»` });
  // initial metrics (if given) become the first snapshot
  logDiff({ account_id: id, user_id: me.id, before: { status: v.status }, after: v, fields: TRACK });
  res.json(getAccount(id));
});

r.put('/accounts/:id', (req, res) => {
  const acc = getAccount(req.params.id);
  if (!acc) return res.status(404).json({ error: 'الحساب غير موجود' });
  if (!canAccess(req.user, acc)) return res.status(403).json(FORBIDDEN);
  const b = req.body || {};
  const owner = b.user_id ? resolveOwner(req.user, b.user_id, res) : { id: acc.user_id, group_id: acc.owner_group };
  if (!owner) return;
  const err = trackError(b);
  if (err) return res.status(400).json({ error: err });
  const v = merge(FIELDS, acc, b);
  if (!v.mobile && !v.email) return res.status(400).json({ error: 'يجب إدخال رقم الجوال أو البريد الإلكتروني' });
  if (v.type_id !== acc.type_id || owner.group_id !== acc.owner_group) {
    const type = db.prepare('SELECT * FROM account_types WHERE id = ?').get(v.type_id);
    if (!type || type.group_id !== owner.group_id) return res.status(400).json({ error: 'نوع الحساب لا يتبع مجموعة مالك الحساب' });
  }
  db.prepare(`UPDATE accounts SET user_id = ?, ${FIELDS.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(owner.id, ...FIELDS.map((f) => v[f]), acc.id);
  if (owner.id !== acc.user_id) {
    const name = db.prepare('SELECT name FROM users WHERE id = ?').get(owner.id).name;
    logEvent({ account_id: acc.id, user_id: req.user.id, kind: 'updated', summary: `نقل ملكية الحساب من «${acc.owner_name}» إلى «${name}»` });
  }
  logDiff({ account_id: acc.id, user_id: req.user.id, before: acc, after: v, fields: FIELDS });
  res.json(getAccount(acc.id));
});

r.delete('/accounts/:id', (req, res) => {
  const acc = getAccount(req.params.id);
  if (!acc) return res.status(404).json({ error: 'الحساب غير موجود' });
  if (!canAccess(req.user, acc)) return res.status(403).json(FORBIDDEN);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(acc.id);
  res.json({ ok: true });
});

r.post('/accounts/:id/updates', (req, res) => {
  const acc = getAccount(req.params.id);
  if (!acc) return res.status(404).json({ error: 'الحساب غير موجود' });
  if (!canAccess(req.user, acc)) return res.status(403).json(FORBIDDEN);
  const err = quickUpdate({ table: 'accounts', row: acc, account_id: acc.id, user_id: req.user.id, body: req.body });
  if (err) return res.status(400).json({ error: err });
  res.json(getAccount(acc.id));
});

r.get('/accounts/:id/events', (req, res) => {
  const acc = getAccount(req.params.id);
  if (!acc) return res.status(404).json({ error: 'الحساب غير موجود' });
  if (!canAccess(req.user, acc)) return res.status(403).json(FORBIDDEN);
  const rows = db.prepare(`
    SELECT e.*, u.name AS actor_name, p.name AS page_name
    FROM account_events e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN pages p ON p.id = e.page_id
    WHERE e.account_id = ? ORDER BY e.id DESC LIMIT ?`).all(acc.id, Number(req.query.limit) || 100);
  res.json(rows.map((e) => ({ ...e, data: e.data ? JSON.parse(e.data) : null })));
});

// ---- pages ----
r.get('/accounts/:id/pages', (req, res) => {
  const acc = getAccount(req.params.id);
  if (!acc) return res.status(404).json({ error: 'الحساب غير موجود' });
  if (!canAccess(req.user, acc)) return res.status(403).json(FORBIDDEN);
  res.json(db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM entity_notes n WHERE n.entity_type = 'page' AND n.entity_id = p.id) AS note_count
    FROM pages p WHERE p.account_id = ? ORDER BY p.name`).all(acc.id));
});

r.post('/accounts/:id/pages', (req, res) => {
  const acc = getAccount(req.params.id);
  if (!acc) return res.status(404).json({ error: 'الحساب غير موجود' });
  if (!canAccess(req.user, acc)) return res.status(403).json(FORBIDDEN);
  if (!acc.allows_pages) return res.status(400).json({ error: 'نوع هذا الحساب لا يسمح بإضافة صفحات' });
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'الاسم مطلوب' });
  const err = trackError(b);
  if (err) return res.status(400).json({ error: err });
  const v = merge(PAGE_FIELDS, {}, b);
  const id = db.prepare(`INSERT INTO pages (account_id, ${PAGE_FIELDS.join(', ')}) VALUES (?${',?'.repeat(PAGE_FIELDS.length)})`)
    .run(acc.id, ...PAGE_FIELDS.map((f) => v[f])).lastInsertRowid;
  logEvent({ account_id: acc.id, page_id: id, user_id: req.user.id, kind: 'page_created', summary: `إضافة صفحة «${v.name}»` });
  logDiff({ account_id: acc.id, page_id: id, page_name: v.name, user_id: req.user.id, before: { status: v.status }, after: v, fields: TRACK });
  res.json(getPageRow(id));
});

const getPage = (id) => db.prepare(`
  SELECT p.*, a.user_id, u.group_id AS owner_group
  FROM pages p JOIN accounts a ON a.id = p.account_id JOIN users u ON u.id = a.user_id
  WHERE p.id = ?`).get(id);

r.put('/pages/:id', (req, res) => {
  const page = getPage(req.params.id);
  if (!page) return res.status(404).json({ error: 'الصفحة غير موجودة' });
  if (!canAccess(req.user, page)) return res.status(403).json(FORBIDDEN);
  const b = req.body || {};
  const err = trackError(b);
  if (err) return res.status(400).json({ error: err });
  const v = merge(PAGE_FIELDS, page, b);
  if (!v.name) return res.status(400).json({ error: 'الاسم مطلوب' });
  db.prepare(`UPDATE pages SET ${PAGE_FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(...PAGE_FIELDS.map((f) => v[f]), page.id);
  logDiff({ account_id: page.account_id, page_id: page.id, page_name: v.name, user_id: req.user.id, before: page, after: v, fields: PAGE_FIELDS });
  res.json(getPageRow(page.id));
});

r.post('/pages/:id/updates', (req, res) => {
  const page = getPage(req.params.id);
  if (!page) return res.status(404).json({ error: 'الصفحة غير موجودة' });
  if (!canAccess(req.user, page)) return res.status(403).json(FORBIDDEN);
  const err = quickUpdate({ table: 'pages', row: page, account_id: page.account_id, page_id: page.id, page_name: page.name, user_id: req.user.id, body: req.body });
  if (err) return res.status(400).json({ error: err });
  res.json(getPageRow(page.id));
});

r.delete('/pages/:id', (req, res) => {
  const page = getPage(req.params.id);
  if (!page) return res.status(404).json({ error: 'الصفحة غير موجودة' });
  if (!canAccess(req.user, page)) return res.status(403).json(FORBIDDEN);
  db.prepare('DELETE FROM pages WHERE id = ?').run(page.id);
  // page row is gone, so page_id stays null; the name lives in the summary
  logEvent({ account_id: page.account_id, user_id: req.user.id, kind: 'page_deleted', summary: `حذف صفحة «${page.name}»` });
  res.json({ ok: true });
});

// ---- facebook sync ----
// Writes go through quickUpdate() so logDiff, the metrics/checked events, last_checked_at,
// prev_followers and the sparkline are all inherited — there is no second metrics path.
const NO_TOKEN = 'لم يتم ربط فيسبوك — أضف FB_TOKEN في إعدادات الخادم';
const NO_LINK = 'لا يوجد رابط فيسبوك — أضفه من «تعديل»';
const BAD_LINK = 'الرابط ليس رابط صفحة فيسبوك صالحًا';
const IS_PROFILE = 'هذا رابط حساب شخصي — فيسبوك لا يتيح قراءة بياناته؛ استخدم التحديث اليدوي';

const syncablePage = (p) => { const n = fb.node(p.url); return !!n && !n.profile; };

// one account or one page -> {ok, error}. Never throws for a Graph-level problem; a thrown
// non-FbError is a real bug and reaches the express error handler.
async function syncTarget({ table, row, account_id, page_id = null, page_name = null, link, user_id }) {
  // `skipped`: the row itself is not a readable Page. Not a failure when its pages carry the value —
  // a personal profile that owns real Pages is the common shape.
  const n = fb.node(link);
  if (!n) return { ok: false, skipped: true, error: link ? BAD_LINK : NO_LINK };
  if (n.profile) return { ok: false, skipped: true, error: IS_PROFILE };
  // sync_seen = {n: <the live name last observed>, p: {post-id: [shares, reactions, comments]}}
  const prev = JSON.parse(row.sync_seen || 'null');
  let m;
  try {
    m = await fb.fetchMetrics(n.id, prev?.p ?? null, row.last_checked_at);
  } catch (e) {
    if (!(e instanceof fb.FbError)) throw e;
    // 803 is the ONLY code that unambiguously means the object is gone (a renamed or deleted page).
    // Everything else — expired token, missing role, rate limit — describes OUR token, not their
    // account, so it must never rewrite status. Flipping fires the existing account_status notice.
    if (e.gone && row.status === 'active')
      quickUpdate({ table, row, account_id, page_id, page_name, user_id, body: { status: 'closed' }, via: 'sync' });
    return { ok: false, error: e.message };
  }
  // every await is done: better-sqlite3 is synchronous, and an await inside a transaction would
  // commit early and silently drop the writes after it.
  const body = {};
  if (m.followers != null) body.followers = m.followers;               // absent, never 0, when withheld
  if (m.posts) body.posts_count = (row.posts_count ?? 0) + m.posts;    // Graph has no lifetime counter
  for (const f of ['shares', 'reactions', 'comments'])
    if (m[f]) body[f] = (row[f] ?? 0) + m[f];
  const err = quickUpdate({ table, row, account_id, page_id, page_name, user_id, body, via: 'sync' });
  if (err) return { ok: false, error: err };
  // sync-only columns, outside TRACK: posts_today would log a "metrics" drop every midnight,
  // and sync_seen is a diff baseline nothing ever queries.
  db.prepare(`UPDATE ${table} SET posts_today = ?, sync_seen = ? WHERE id = ?`)
    .run(m.postsToday, JSON.stringify({ n: m.name, p: m.seen }), row.id);
  // The live Page name vs the team's label: reported in the timeline, never silently renamed — and
  // only when NEWLY observed. A mismatch is a state, not an event: logging it every sync would bury
  // the timeline under the same line forever.
  if (m.name && m.name !== row.name && m.name !== prev?.n)
    logEvent({ account_id, page_id, user_id, kind: 'updated',
      summary: `${page_id ? `صفحة «${page_name}»: ` : ''}الاسم على فيسبوك «${m.name}» يختلف عن الاسم المسجّل «${row.name}»` });
  return { ok: true };
}

// Express 4 does not catch a rejected promise — every async route carries its own try/catch/next
r.get('/sync/health', async (req, res, next) => {
  try { res.json(await fb.health()); } catch (e) { next(e); }
});

// the account AND every syncable page under it: one button, because a fresh account beside
// week-old pages is worse than either extreme. Bulk is a client-side loop over this route.
r.post('/accounts/:id/sync', async (req, res, next) => {
  try {
    const acc = getAccount(req.params.id);
    if (!acc) return res.status(404).json({ error: 'الحساب غير موجود' });
    if (!canAccess(req.user, acc)) return res.status(403).json(FORBIDDEN);
    if (!fb.enabled()) return res.status(400).json({ error: NO_TOKEN });
    const pages = db.prepare('SELECT * FROM pages WHERE account_id = ? ORDER BY name').all(acc.id).filter(syncablePage);
    const self = fb.node(acc.link);
    if ((!self || self.profile) && !pages.length)
      return res.status(400).json({ error: acc.link ? (self ? IS_PROFILE : BAD_LINK) : NO_LINK });
    // account_error rather than a 400: a personal profile that owns real Pages is the common shape,
    // and syncing those pages anyway is the whole point.
    const own = await syncTarget({ table: 'accounts', row: acc, account_id: acc.id, link: acc.link, user_id: req.user.id });
    const out = [];
    // ponytail: serial — ~400ms each; an account past ~10 pages would want its own client-side loop
    for (const p of pages)
      out.push({ id: p.id, name: p.name, ...await syncTarget({
        table: 'pages', row: p, account_id: acc.id, page_id: p.id, page_name: p.name, link: p.url, user_id: req.user.id }) });
    res.json({ account: getAccount(acc.id), account_error: own.ok ? null : own.error,
      account_skipped: !!own.skipped, pages: out });
  } catch (e) { next(e); }
});

r.post('/pages/:id/sync', async (req, res, next) => {
  try {
    const page = getPage(req.params.id);
    if (!page) return res.status(404).json({ error: 'الصفحة غير موجودة' });
    if (!canAccess(req.user, page)) return res.status(403).json(FORBIDDEN);
    if (!fb.enabled()) return res.status(400).json({ error: NO_TOKEN });
    const out = await syncTarget({ table: 'pages', row: page, account_id: page.account_id,
      page_id: page.id, page_name: page.name, link: page.url, user_id: req.user.id });
    if (!out.ok) return res.status(400).json({ error: out.error });
    res.json(getPageRow(page.id));
  } catch (e) { next(e); }
});

module.exports = r;
module.exports.STATUS_AR = STATUS_AR;
module.exports.EVENT_AR = EVENT_AR;
