const db = require('./db');
const { push } = require('./push');

const KINDS = new Set(['task_new', 'task_due_soon', 'task_overdue', 'task_done', 'account_stale', 'account_status', 'task_nudge', 'message', 'mention', 'comment', 'profile_request', 'profile_reviewed', 'account_daily_due', 'group_daily_due']);
const ins = db.prepare('INSERT OR IGNORE INTO notifications (user_id, key, kind, title, body, link) VALUES (?,?,?,?,?,?)');
// idempotent per (user, key) — UNIQUE(user_id, key) + INSERT OR IGNORE. kind enum lives here (no DB CHECK)
const insert = db.transaction((userIds, { key, kind, title, body = null, link = null }) => {
  if (!KINDS.has(kind)) throw new Error(`unknown notification kind: ${kind}`);
  return userIds.filter((uid) => ins.run(uid, key, kind, title, body, link).changes > 0);
});
// update-style events every super admin is copied on; personal kinds (reminders, mentions,
// private messages, review outcomes) stay targeted to their audience only
const UPDATE_KINDS = new Set(['task_new', 'task_done', 'account_status', 'profile_request']);
const activeSupers = () =>
  db.prepare("SELECT id FROM users WHERE role = 'super' AND active = 1").all().map((u) => u.id);

// rows actually inserted (not de-duplicated) also go out as FCM pushes; fire-and-forget, never blocks the request
// actorId: the user who caused the event — excluded so supers aren't notified of their own actions
const notify = (userIds, n, actorId = null) => {
  const ids = UPDATE_KINDS.has(n.kind)
    ? [...new Set([...userIds, ...activeSupers()])].filter((id) => id !== actorId)
    : userIds;
  const fresh = insert(ids, n);
  if (fresh.length) push(fresh, n).catch((e) => console.warn('push:', e.message));
};

// every active admin who LEADS this group (admin_groups is authoritative — an admin may lead several)
const groupAdmins = (gid, exceptId) =>
  db.prepare(`SELECT u.id FROM users u JOIN admin_groups ag ON ag.user_id = u.id
    WHERE ag.group_id = ? AND u.role = 'admin' AND u.active = 1 AND u.id != ?`).all(gid, exceptId).map((u) => u.id);

// local calendar day as YYYY-MM-DD (due_date is a client-local ISO date)
const day = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toLocaleDateString('en-CA'); };

function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); // Thursday of this ISO week
  const week = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ponytail: a leader is only nudged about a miss late in the day; before that it is not yet a miss.
const DAILY_DIGEST_HOUR = 16;

// poll-time generators for the caller (due_soon / overdue tasks, stale accounts, daily updates); cheap + idempotent via keys
function generateDerived(user) {
  const { taskDone, STALE_DAYS } = require('./routes/tasks'); // lazy: tasks.js requires this module
  const today = day(0), tomorrow = day(1);
  if (user.group_id) {
    const tasks = db.prepare(`SELECT id, title, substr(due_date, 1, 10) AS due FROM tasks
      WHERE group_id = ? AND archived = 0 AND due_date IS NOT NULL AND substr(due_date, 1, 10) <= ?`).all(user.group_id, tomorrow);
    for (const t of tasks) {
      if (taskDone(t.id, [user.id])) continue;
      if (t.due < today)
        notify([user.id], { key: `task:${t.id}:overdue:${t.due}`, kind: 'task_overdue', title: `مهمة متأخرة: ${t.title}`, body: `كانت تستحق في ${t.due}`, link: `/tasks?task=${t.id}` });
      else
        notify([user.id], { key: `task:${t.id}:due_soon:${t.due}`, kind: 'task_due_soon', title: `مهمة تستحق قريبًا: ${t.title}`, body: `الاستحقاق ${t.due}`, link: `/tasks?task=${t.id}` });
    }
  }
  const week = isoWeek();
  const stale = db.prepare(`SELECT id, name, last_checked_at FROM accounts
    WHERE user_id = ? AND (last_checked_at IS NULL OR last_checked_at < datetime('now', ?))`).all(user.id, `-${STALE_DAYS} days`);
  for (const a of stale)
    notify([user.id], { key: `account:${a.id}:stale:${week}`, kind: 'account_stale', title: `حساب يحتاج فحصًا: ${a.name}`,
      body: `آخر فحص: ${a.last_checked_at ? a.last_checked_at.slice(0, 10) : 'لم يُفحص بعد'}`, link: `/accounts?account=${a.id}` });

  // ---- daily update compliance -------------------------------------------------------------
  // same predicate as accounts.js DUE_TODAY_SQL (inlined here: accounts.js requires this module)
  const dueSql = `a.status = 'active' AND NOT EXISTS (
    SELECT 1 FROM account_daily d WHERE d.account_id = a.id AND d.page_id IS NULL AND d.day = ?)`;
  const mine = db.prepare(`SELECT a.id, a.name FROM accounts a WHERE a.user_id = ? AND ${dueSql} ORDER BY a.name`)
    .all(user.id, today);
  if (mine.length)
    notify([user.id], { key: `daily:${user.id}:${today}`, kind: 'account_daily_due',
      title: `${mine.length} حساب بانتظار تحديث اليوم`,
      body: mine.slice(0, 3).map((a) => a.name).join('، ') + (mine.length > 3 ? ` و${mine.length - 3} غيرها` : ''),
      link: '/accounts?daily=1' });

  // leaders get ONE digest per group per day, and only once the day is effectively over
  if (user.role === 'admin' && new Date().getHours() >= DAILY_DIGEST_HOUR)
    for (const gid of db.prepare('SELECT group_id FROM admin_groups WHERE user_id = ?').all(user.id).map((r) => r.group_id)) {
      const rows = db.prepare(`SELECT u.name, COUNT(*) c FROM accounts a JOIN users u ON u.id = a.user_id
        WHERE u.group_id = ? AND u.role = 'user' AND u.active = 1 AND ${dueSql} GROUP BY u.id ORDER BY c DESC`).all(gid, today);
      if (!rows.length) continue;
      const n = rows.reduce((s, r) => s + r.c, 0);
      notify([user.id], { key: `daily:group:${gid}:${today}`, kind: 'group_daily_due',
        title: `${n} حساب لم يُحدَّث اليوم`,
        body: rows.slice(0, 3).map((r) => `${r.name} (${r.c})`).join('، ') + (rows.length > 3 ? ` و${rows.length - 3} غيرهم` : ''),
        link: '/' });
    }
}

module.exports = { notify, groupAdmins, day, generateDerived, DAILY_DIGEST_HOUR };
