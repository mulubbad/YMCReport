const express = require('express');
const db = require('../db');
const { auth, requireRole } = require('../auth');

const r = express.Router();
r.use(auth);
// scoped to the two /activity routes — a router-level requireRole would 403 every
// downstream /api route for non-admins (routers fall through on unmatched paths)
const adminOnly = requireRole('admin', 'super');

const dayStr = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const valid = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// query -> {from, to}, defaulting to the last 30 days; swapped if reversed
function range(q) {
  let from = valid(q.from) ? q.from : dayStr(-29);
  let to = valid(q.to) ? q.to : dayStr(0);
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

// per-user totals in range: admin -> own group, super -> all (+?group_id)
r.get('/activity/summary', adminOnly, (req, res) => {
  const { from, to } = range(req.query);
  const where = [], args = [from, to];
  if (req.user.role === 'admin') { where.push('u.group_id = ?'); args.push(req.user.group_id); }
  else if (req.query.group_id) { where.push('u.group_id = ?'); args.push(req.query.group_id); }
  const rows = db.prepare(`
    SELECT u.id, COUNT(a.day) AS active_days, COALESCE(SUM(a.seconds), 0) AS total_seconds
    FROM users u LEFT JOIN user_activity a ON a.user_id = u.id AND a.day >= ? AND a.day <= ?
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY u.id`).all(...args);
  res.json({ from, to, users: rows });
});

// per-day seconds for one user (active days only)
r.get('/activity/:id', adminOnly, (req, res) => {
  const target = db.prepare('SELECT id, group_id FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (req.user.role === 'admin' && target.group_id !== req.user.group_id)
    return res.status(403).json({ error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' });
  const { from, to } = range(req.query);
  const days = db.prepare('SELECT day, seconds FROM user_activity WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY day')
    .all(target.id, from, to);
  res.json({ from, to, days });
});

module.exports = r;
