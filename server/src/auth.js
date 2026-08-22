const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'ymc-dev-secret';

const sign = (u) => jwt.sign({ id: u.id, role: u.role, group_id: u.group_id }, SECRET, { expiresIn: '7d' });

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول من جديد' });
  }
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' });

module.exports = { sign, auth, requireRole };
