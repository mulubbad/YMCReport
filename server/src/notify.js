const db = require('./db');
const { push } = require('./push');

const KINDS = new Set(['task_new', 'task_due_soon', 'task_overdue', 'task_done', 'account_stale', 'account_status', 'task_nudge', 'message', 'mention', 'profile_request', 'profile_reviewed']);
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

const groupAdmins = (gid, exceptId) =>
  db.prepare("SELECT id FROM users WHERE group_id = ? AND role = 'admin' AND active = 1 AND id != ?").all(gid, exceptId).map((u) => u.id);

// local calendar day as YYYY-MM-DD (due_date is a client-local ISO date)
const day = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toLocaleDateString('en-CA'); };

function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); // Thursday of this ISO week
  const week = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// poll-time generators for the caller (due_soon / overdue tasks, stale accounts); cheap + idempotent via keys
function generateDerived(user) {
  const { taskDone, STALE_DAYS } = require('./routes/tasks'); // lazy: tasks.js requires this module
  const today = day(0), tomorrow = day(1);
  if (user.group_id) {
    const tasks = db.prepare(`SELECT id, title, substr(due_date, 1, 10) AS due FROM tasks
      WHERE group_id = ? AND archived = 0 AND due_date IS NOT NULL AND substr(due_date, 1, 10) <= ?`).all(user.group_id, tomorrow);
    for (const t of tasks) {
      if (taskDone(t.id, [user.id])) continue;
      if (t.due < today)
        notify([user.id], { key: `task:${t.id}:overdue:${t.due}`, kind: 'task_overdue', title: `مهمة متأخرة: ${t.title}`, body: `كانت تستحق في ${t.due}`, link: '/tasks' });
      else
        notify([user.id], { key: `task:${t.id}:due_soon:${t.due}`, kind: 'task_due_soon', title: `مهمة تستحق قريبًا: ${t.title}`, body: `الاستحقاق ${t.due}`, link: '/tasks' });
    }
  }
  const week = isoWeek();
  const stale = db.prepare(`SELECT id, name, last_checked_at FROM accounts
    WHERE user_id = ? AND (last_checked_at IS NULL OR last_checked_at < datetime('now', ?))`).all(user.id, `-${STALE_DAYS} days`);
  for (const a of stale)
    notify([user.id], { key: `account:${a.id}:stale:${week}`, kind: 'account_stale', title: `حساب يحتاج فحصًا: ${a.name}`,
      body: `آخر فحص: ${a.last_checked_at ? a.last_checked_at.slice(0, 10) : 'لم يُفحص بعد'}`, link: '/accounts' });
}

module.exports = { notify, groupAdmins, day, generateDerived };
