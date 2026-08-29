const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'ymc-dev-secret';

const sign = (u) => jwt.sign({ id: u.id, role: u.role, group_id: u.group_id }, SECRET, { expiresIn: '7d' });

const verify = (token) => jwt.verify(token, SECRET);

// last-activity stamp, at most one write per user per minute. The gap since the previous
// stamp is credited to user_activity as online time: gaps up to 5 min count in full (an open
// tab pings every ~60s via the layout badge poll), longer breaks credit only the new ping.
let stmts;
function touch(id) {
  const db = require('./db');
  stmts ??= {
    prev: db.prepare('SELECT last_seen_at FROM users WHERE id = ?'),
    stamp: db.prepare(`UPDATE users SET last_seen_at = datetime('now') WHERE id = ?`),
    credit: db.prepare(`INSERT INTO user_activity (user_id, day, seconds) VALUES (?, date('now'), ?)
      ON CONFLICT(user_id, day) DO UPDATE SET seconds = seconds + excluded.seconds`),
  };
  const row = stmts.prev.get(id);
  if (!row) return; // token for a deleted user
  const gap = row.last_seen_at ? (Date.now() - Date.parse(row.last_seen_at.replace(' ', 'T') + 'Z')) / 1000 : Infinity;
  if (gap < 60) return;
  stmts.stamp.run(id);
  stmts.credit.run(id, Math.round(gap <= 300 ? gap : 60));
}

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    req.user = verify(token);
    touch(req.user.id);
    next();
  } catch {
    res.status(401).json({ error: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول من جديد' });
  }
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' });

const FORBIDDEN = { error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' };

// ---- group scope -------------------------------------------------------------------------------
// An admin may LEAD SEVERAL groups (table admin_groups); users.group_id stays their default one.
// Every scoped route resolves one active group through scopeGid(), so each group is an encapsulated
// workspace: the admin is effectively a super restricted to their own set.

// group ids the caller controls. super -> null (means "every group"); admin -> admin_groups;
// member -> their own group. Never returns null for admin/user, so `.includes` is always safe.
function managedIds(me) {
  if (me.role === 'super') return null;
  if (me.role !== 'admin') return me.group_id ? [me.group_id] : [];
  return require('./db').prepare('SELECT group_id FROM admin_groups WHERE user_id = ? ORDER BY group_id')
    .all(me.id).map((r) => r.group_id);
}

// may the caller manage this group? Guards every id-addressed row (account/sim/task/note/user).
// A group-less admin manages nothing — this is also what stops NULL === NULL from matching orphans.
function canManage(me, gid) {
  if (gid == null) return false;
  const ids = managedIds(me);
  return ids === null || ids.includes(Number(gid));
}

// The active group of a request: ?group_id when the caller may use it, otherwise their default.
// super with no ?group_id -> null = all groups. Returns false (after sending 403) when ?group_id
// names a group the caller does not lead; callers do `if (gid === false) return;`.
function scopeGid(req, res) {
  const me = req.user, asked = Number(req.query.group_id) || null;
  const ids = managedIds(me);
  if (ids === null) return asked;
  if (asked) {
    if (!ids.includes(asked)) { res.status(403).json(FORBIDDEN); return false; }
    return asked;
  }
  return ids.includes(me.group_id) ? me.group_id : (ids[0] ?? null);
}

// replace an admin's managed groups (super only). Keeps users.group_id — the default group — inside the set.
const setManagedGroups = (userId, ids) => {
  const db = require('./db');
  db.transaction(() => {
    db.prepare('DELETE FROM admin_groups WHERE user_id = ?').run(userId);
    const ins = db.prepare('INSERT OR IGNORE INTO admin_groups (user_id, group_id) VALUES (?, ?)');
    for (const g of ids) ins.run(userId, g);
  })();
};

// owner assignment gate (sims + accounts): user -> self only, admin -> any group they lead, super -> anyone.
// Returns {id, group_id}, or null after sending the error response.
function resolveOwner(me, ownerId, res) {
  if (ownerId === me.id) return { id: me.id, group_id: me.group_id };
  if (me.role === 'user') { res.status(403).json(FORBIDDEN); return null; }
  const target = require('./db').prepare('SELECT id, group_id FROM users WHERE id = ?').get(ownerId);
  if (!target) { res.status(404).json({ error: 'المستخدم غير موجود' }); return null; }
  if (me.role !== 'super' && !canManage(me, target.group_id)) { res.status(403).json(FORBIDDEN); return null; }
  return target;
}

module.exports = { sign, verify, auth, requireRole, resolveOwner, managedIds, canManage, scopeGid, setManagedGroups, FORBIDDEN };
