const express = require('express');
const db = require('../db');
const { auth } = require('../auth');
const { generateDerived } = require('../notify');

const r = express.Router();
r.use(auth);

const unread = (uid) => db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(uid).c;

r.get('/notifications', (req, res) => {
  generateDerived(req.user);
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  // archive filters: ?before=<id> (cursor), ?unread=1, ?kind=<kind>
  const where = ['user_id = ?'], args = [req.user.id];
  if (Number(req.query.before)) { where.push('id < ?'); args.push(Number(req.query.before)); }
  if (req.query.unread === '1') where.push('read = 0');
  if (req.query.kind) { where.push('kind = ?'); args.push(String(req.query.kind)); }
  const items = db.prepare(`SELECT id, kind, title, body, link, read, created_at FROM notifications
    WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...args, limit + 1);
  const more = items.length > limit;
  if (more) items.pop();
  res.json({ unread: unread(req.user.id), items, next: more ? items[items.length - 1].id : null }); // pass next back as ?before=
});

// {ids:[...]} or {all:true}; rows of other users are never touched (user_id in WHERE)
r.put('/notifications/read', (req, res) => {
  const b = req.body || {};
  if (b.all) db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(req.user.id);
  else if (Array.isArray(b.ids) && b.ids.length) {
    if (!b.ids.every(Number.isInteger)) return res.status(400).json({ error: 'معرّفات غير صالحة' });
    db.prepare(`UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${b.ids.map(() => '?').join(',')})`).run(req.user.id, ...b.ids);
  }
  res.json({ unread: unread(req.user.id) });
});

module.exports = r;
