const express = require('express');
const db = require('../db');
const { auth, canManage } = require('../auth');
const { notify, groupAdmins } = require('../notify');

const r = express.Router();
r.use(auth);

const LABEL_AR = { account: 'الحساب', page: 'الصفحة', sim: 'خط الاتصال' };
const NOT_FOUND = { account: 'الحساب غير موجود', page: 'الصفحة غير موجودة', sim: 'الخط غير موجود' };
const LINK = { account: '/accounts', page: '/accounts', sim: '/sims' };
const FORBIDDEN = { error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' };

const OWNER_SQL = {
  account: 'SELECT a.user_id, u.group_id, a.name FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.id = ?',
  page: 'SELECT a.user_id, u.group_id, p.name FROM pages p JOIN accounts a ON a.id = p.account_id JOIN users u ON u.id = a.user_id WHERE p.id = ?',
  sim: 'SELECT s.user_id, u.group_id, s.number AS name FROM sim_lines s JOIN users u ON u.id = s.user_id WHERE s.id = ?',
};
// entity owner {user_id, group_id, name}; null when the type or id is unknown
const resolveOwner = (type, id) => (OWNER_SQL[type] ? db.prepare(OWNER_SQL[type]).get(id) : null) ?? null;

// thread access: owner, admins of the owner's group, super
const canAccess = (me, o) => me.role === 'super' || (me.role === 'admin' ? canManage(me, o.group_id) : o.user_id === me.id);

// {type, id} from query/body → {type, id, user_id, group_id, name}; sends 400/404/403 and returns null otherwise
function entity(req, res, src) {
  const type = String(src.type ?? ''), id = Number(src.id);
  if (!LABEL_AR[type] || !Number.isInteger(id)) { res.status(400).json({ error: 'نوع الكيان أو معرّفه غير صالح' }); return null; }
  const o = resolveOwner(type, id);
  if (!o) { res.status(404).json({ error: NOT_FOUND[type] }); return null; }
  if (!canAccess(req.user, o)) { res.status(403).json(FORBIDDEN); return null; }
  return { type, id, ...o };
}

const NOTE_SQL = `SELECT n.id, n.body, n.user_id AS author_id, u.name AS author_name, u.role AS author_role, n.created_at
  FROM entity_notes n LEFT JOIN users u ON u.id = n.user_id`;

r.get('/notes', (req, res) => {
  const e = entity(req, res, req.query);
  if (e) res.json(db.prepare(`${NOTE_SQL} WHERE n.entity_type = ? AND n.entity_id = ? ORDER BY n.id`).all(e.type, e.id));
});

r.post('/notes', (req, res) => {
  const b = req.body || {};
  const e = entity(req, res, b);
  if (!e) return;
  const body = String(b.body ?? '').trim();
  if (!body || body.length > 2000) return res.status(400).json({ error: 'نص الملاحظة مطلوب (حتى 2000 حرف)' });
  const me = req.user;
  const id = db.prepare('INSERT INTO entity_notes (entity_type, entity_id, user_id, body) VALUES (?,?,?,?)').run(e.type, e.id, me.id, body).lastInsertRowid;
  // counterparts: the group's admins except the author, plus the owner when someone else wrote
  const to = groupAdmins(e.group_id, me.id);
  if (e.user_id !== me.id) to.push(e.user_id);
  notify(to, { key: `note:${id}`, kind: 'message', title: `ملاحظة خاصة على ${LABEL_AR[e.type]}: ${e.name}`, body: body.slice(0, 120), link: LINK[e.type] });
  res.json(db.prepare(`${NOTE_SQL} WHERE n.id = ?`).get(id));
});

r.delete('/notes/:id', (req, res) => {
  const n = db.prepare('SELECT id, user_id FROM entity_notes WHERE id = ?').get(req.params.id);
  if (!n) return res.status(404).json({ error: 'الملاحظة غير موجودة' });
  if (req.user.role !== 'super' && n.user_id !== req.user.id) return res.status(403).json(FORBIDDEN);
  db.prepare('DELETE FROM entity_notes WHERE id = ?').run(n.id);
  res.json({ ok: true });
});

module.exports = r;
