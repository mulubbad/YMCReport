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

// owner assignment gate (sims + accounts): user -> self only, admin -> own group, super -> anyone.
// Returns {id, group_id}, or null after sending the error response.
function resolveOwner(me, ownerId, res) {
  if (ownerId === me.id) return { id: me.id, group_id: me.group_id };
  if (me.role === 'user') { res.status(403).json({ error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' }); return null; }
  const target = require('./db').prepare('SELECT id, group_id FROM users WHERE id = ?').get(ownerId);
  if (!target) { res.status(404).json({ error: 'المستخدم غير موجود' }); return null; }
  if (me.role === 'admin' && target.group_id !== me.group_id) { res.status(403).json({ error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' }); return null; }
  return target;
}

module.exports = { sign, verify, auth, requireRole, resolveOwner };
