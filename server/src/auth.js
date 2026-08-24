const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'ymc-dev-secret';

const sign = (u) => jwt.sign({ id: u.id, role: u.role, group_id: u.group_id }, SECRET, { expiresIn: '7d' });

const verify = (token) => jwt.verify(token, SECRET);

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    req.user = verify(token);
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
