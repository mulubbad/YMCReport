const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { sign, auth, requireRole } = require('../auth');

const r = express.Router();
const PUBLIC = 'id, username, name, role, group_id, active, created_at';

r.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
  if (!u || !u.active || !bcrypt.compareSync(password || '', u.password_hash))
    return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  res.json({ token: sign(u), user: { id: u.id, username: u.username, name: u.name, role: u.role, group_id: u.group_id } });
});

r.get('/me', auth, (req, res) => {
  const u = db.prepare(`SELECT ${PUBLIC} FROM users WHERE id = ?`).get(req.user.id);
  if (!u) return res.status(404).json({ error: 'المستخدم غير موجود' });
  res.json(u);
});

// ---- groups (super) ----
r.get('/groups', auth, requireRole('super'), (req, res) => {
  res.json(db.prepare(`SELECT g.*, (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id) AS user_count
                       FROM groups g ORDER BY g.name`).all());
});

r.post('/groups', auth, requireRole('super'), (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
  const info = db.prepare('INSERT INTO groups (name) VALUES (?)').run(name);
  res.json(db.prepare('SELECT * FROM groups WHERE id = ?').get(info.lastInsertRowid));
});

r.put('/groups/:id', auth, requireRole('super'), (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
  const info = db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'المجموعة غير موجودة' });
  res.json(db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id));
});

r.delete('/groups/:id', auth, requireRole('super'), (req, res) => {
  const info = db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'المجموعة غير موجودة' });
  res.json({ ok: true });
});

// ---- users ----
r.get('/users', auth, requireRole('admin', 'super'), (req, res) => {
  const gid = req.user.role === 'admin' ? req.user.group_id : req.query.group_id;
  // admin without a group (e.g. its group was deleted) sees nothing, not everything
  if (!gid && req.user.role !== 'super') return res.json([]);
  const rows = gid
    ? db.prepare(`SELECT ${PUBLIC} FROM users WHERE group_id = ? ORDER BY name`).all(gid)
    : db.prepare(`SELECT ${PUBLIC} FROM users ORDER BY name`).all();
  res.json(rows);
});

r.post('/users', auth, requireRole('admin', 'super'), (req, res) => {
  const b = req.body || {};
  if (!b.username || !b.password || !b.name)
    return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور والاسم حقول مطلوبة' });
  const role = req.user.role === 'admin' ? 'user' : (b.role || 'user');
  const group_id = req.user.role === 'admin' ? req.user.group_id : (b.group_id ?? null);
  if (!['super', 'admin', 'user'].includes(role)) return res.status(400).json({ error: 'الدور المحدد غير صالح' });
  const info = db.prepare('INSERT INTO users (username, password_hash, name, role, group_id) VALUES (?,?,?,?,?)')
    .run(b.username, bcrypt.hashSync(b.password, 10), b.name, role, group_id);
  res.json(db.prepare(`SELECT ${PUBLIC} FROM users WHERE id = ?`).get(info.lastInsertRowid));
});

r.put('/users/:id', auth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  const me = req.user;
  const self = me.id === target.id;
  const adminScope = me.role === 'admin' && target.group_id === me.group_id && target.role === 'user';
  if (!(me.role === 'super' || self || adminScope)) return res.status(403).json({ error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' });

  const allowed = me.role === 'super' ? ['name', 'password', 'role', 'group_id', 'active']
    : self ? ['name', 'password']
    : ['name', 'password', 'active'];
  const b = req.body || {};
  if (b.role && !['super', 'admin', 'user'].includes(b.role)) return res.status(400).json({ error: 'الدور المحدد غير صالح' });
  const sets = [], args = [];
  for (const f of allowed) {
    if (!(f in b)) continue;
    if (f === 'password') { sets.push('password_hash = ?'); args.push(bcrypt.hashSync(b.password, 10)); }
    else if (f === 'active') { sets.push('active = ?'); args.push(b.active ? 1 : 0); }
    else { sets.push(`${f} = ?`); args.push(b[f]); }
  }
  if (sets.length) db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...args, target.id);
  res.json(db.prepare(`SELECT ${PUBLIC} FROM users WHERE id = ?`).get(target.id));
});

r.delete('/users/:id', auth, requireRole('admin', 'super'), (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (req.user.role === 'admin' && !(target.group_id === req.user.group_id && target.role === 'user'))
    return res.status(403).json({ error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' });
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  res.json({ ok: true });
});

module.exports = r;
