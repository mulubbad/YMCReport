const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { sign, auth, requireRole, scopeGid, canManage, managedIds, setManagedGroups, FORBIDDEN } = require('../auth');

const r = express.Router();
const PUBLIC = 'id, username, name, role, group_id, active, last_seen_at, created_at';

// an admin's row carries every group they lead (group_ids); everyone else just their own group
const withGroups = (u) => (u && u.role === 'admin' ? { ...u, group_ids: managedIds(u) } : u);
const getUser = (id) => withGroups(db.prepare(`SELECT ${PUBLIC} FROM users WHERE id = ?`).get(id));

// admin_groups follows the row: non-admins lead nothing; an admin always leads their default group,
// plus whatever super passed in `group_ids`.
function syncAdminGroups(user, body) {
  if (user.role !== 'admin') return setManagedGroups(user.id, []);
  const asked = Array.isArray(body.group_ids) ? body.group_ids.map(Number).filter(Number.isInteger) : null;
  const next = new Set(asked ?? managedIds(user));
  if (user.group_id) next.add(user.group_id);
  setManagedGroups(user.id, [...next]);
}

r.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
  if (!u || !u.active || !bcrypt.compareSync(password || '', u.password_hash))
    return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  db.prepare(`UPDATE users SET last_seen_at = datetime('now') WHERE id = ?`).run(u.id);
  res.json({ token: sign(u), user: { id: u.id, username: u.username, name: u.name, role: u.role, group_id: u.group_id } });
});

r.get('/me', auth, (req, res) => {
  const u = db.prepare(`SELECT ${PUBLIC} FROM users WHERE id = ?`).get(req.user.id);
  if (!u) return res.status(404).json({ error: 'المستخدم غير موجود' });
  res.json(u);
});

// ---- groups ----
// super sees every group; an admin sees exactly the groups they lead — this is the group switcher's source.
r.get('/groups', auth, requireRole('admin', 'super'), (req, res) => {
  const ids = managedIds(req.user);
  const SQL = `SELECT g.*,
      (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id) AS user_count,
      (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id AND u.role = 'user' AND u.active = 1) AS member_count,
      (SELECT COUNT(*) FROM accounts a JOIN users u ON u.id = a.user_id WHERE u.group_id = g.id) AS account_count,
      (SELECT COUNT(*) FROM sim_lines s JOIN users u ON u.id = s.user_id WHERE u.group_id = g.id) AS sim_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.group_id = g.id AND t.archived = 0) AS task_count
    FROM groups g`;
  if (ids === null) return res.json(db.prepare(`${SQL} ORDER BY g.name`).all());
  if (!ids.length) return res.json([]);
  res.json(db.prepare(`${SQL} WHERE g.id IN (${ids.map(() => '?').join(',')}) ORDER BY g.name`).all(...ids));
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
  const gid = scopeGid(req, res);
  if (gid === false) return;
  // admin without a group (e.g. its group was deleted) sees nothing, not everything
  if (!gid && req.user.role !== 'super') return res.json([]);
  const rows = gid
    ? db.prepare(`SELECT ${PUBLIC} FROM users WHERE group_id = ? ORDER BY name`).all(gid)
    : db.prepare(`SELECT ${PUBLIC} FROM users ORDER BY name`).all();
  res.json(rows.map(withGroups));
});

r.post('/users', auth, requireRole('admin', 'super'), (req, res) => {
  const b = req.body || {};
  if (!b.username || !b.password || !b.name)
    return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور والاسم حقول مطلوبة' });
  const role = req.user.role === 'admin' ? 'user' : (b.role || 'user');
  // an admin creates members inside the group they are currently working in
  const gid = req.user.role === 'admin' ? scopeGid(req, res) : (b.group_id ?? null);
  if (gid === false) return;
  if (req.user.role === 'admin' && !gid) return res.status(400).json({ error: 'لا توجد مجموعة مرتبطة بحسابك' });
  if (!['super', 'admin', 'user'].includes(role)) return res.status(400).json({ error: 'الدور المحدد غير صالح' });
  const info = db.prepare('INSERT INTO users (username, password_hash, name, role, group_id) VALUES (?,?,?,?,?)')
    .run(b.username, bcrypt.hashSync(b.password, 10), b.name, role, gid);
  syncAdminGroups({ id: info.lastInsertRowid, role, group_id: gid }, b);
  res.json(getUser(info.lastInsertRowid));
});

r.put('/users/:id', auth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  const me = req.user;
  const self = me.id === target.id;
  const adminScope = me.role === 'admin' && canManage(me, target.group_id) && target.role === 'user';
  if (!(me.role === 'super' || self || adminScope)) return res.status(403).json(FORBIDDEN);

  // self (non-super) can only change password here — profile fields go through /profile/requests
  const allowed = me.role === 'super' ? ['name', 'username', 'password', 'role', 'group_id', 'active']
    : self ? ['password']
    : ['name', 'username', 'password', 'active'];
  const b = req.body || {};
  if (self && 'password' in b && !(b.current_password && bcrypt.compareSync(b.current_password, target.password_hash)))
    return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
  if (b.role && !['super', 'admin', 'user'].includes(b.role)) return res.status(400).json({ error: 'الدور المحدد غير صالح' });
  const sets = [], args = [];
  for (const f of allowed) {
    if (!(f in b)) continue;
    if (f === 'password') { sets.push('password_hash = ?'); args.push(bcrypt.hashSync(b.password, 10)); }
    else if (f === 'active') { sets.push('active = ?'); args.push(b.active ? 1 : 0); }
    else { sets.push(`${f} = ?`); args.push(b[f]); }
  }
  if (sets.length) db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...args, target.id);
  // super may also re-assign which groups an admin leads
  if (me.role === 'super') {
    const after = db.prepare('SELECT id, role, group_id FROM users WHERE id = ?').get(target.id);
    if (after.role !== target.role || after.group_id !== target.group_id || 'group_ids' in b) syncAdminGroups(after, b);
  }
  res.json(getUser(target.id));
});

r.delete('/users/:id', auth, requireRole('admin', 'super'), (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (req.user.role === 'admin' && !(canManage(req.user, target.group_id) && target.role === 'user'))
    return res.status(403).json(FORBIDDEN);
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  res.json({ ok: true });
});

module.exports = r;
