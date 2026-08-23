const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { auth, verify, requireRole } = require('../auth');
const { notify } = require('../notify');
const { push } = require('../push');
const sse = require('../sse');
const storage = require('../storage');

const r = express.Router();
const FORBIDDEN = { error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' };
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next); // express 4 + async handlers

// room = group_id: caller's group; super picks one with ?group_id. Sends 400/403/404 and returns null when not allowed
function room(req, res) {
  const me = req.user, q = Number(req.query.group_id) || null;
  if (me.role !== 'super') {
    if (q && q !== me.group_id) { res.status(403).json(FORBIDDEN); return null; }
    if (!me.group_id) { res.status(400).json({ error: 'لست عضوًا في أي مجموعة' }); return null; }
    return me.group_id;
  }
  if (!q) { res.status(400).json({ error: 'حدّد المجموعة (group_id)' }); return null; }
  if (!db.prepare('SELECT 1 FROM groups WHERE id = ?').get(q)) { res.status(404).json({ error: 'المجموعة غير موجودة' }); return null; }
  return q;
}

const roomUsers = (gid) => db.prepare('SELECT id, name, username, role FROM users WHERE group_id = ? AND active = 1 ORDER BY name').all(gid);

// ---- stream (EventSource can't send headers → JWT in the query; defined before the path-scoped auth below,
// and this router is mounted first in index.js because the other routers' bare r.use(auth) 401s every /api request) ----
r.get('/chat/stream', (req, res) => {
  try { req.user = verify(String(req.query.token || '')); } catch { return res.status(401).json({ error: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول من جديد' }); }
  const gid = room(req, res);
  if (!gid) return;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': connected\n\n');
  sse.add(res, req.user.id, gid);
  sse.broadcastToGroup(gid, 'presence', { online: sse.onlineIds(gid) });
  req.on('close', () => { sse.remove(res); sse.broadcastToGroup(gid, 'presence', { online: sse.onlineIds(gid) }); });
});

r.use('/chat', auth);

// ---- rows ----
const ROW_SQL = `SELECT m.id, m.group_id, m.user_id, u.name AS user_name, u.role AS user_role, m.body, m.image_key, m.mentions, m.hashtags, m.pinned, m.deleted, m.created_at
  FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id`;
const names = (ids) => (ids.length ? db.prepare(`SELECT id, name FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : []);

async function format(rows) {
  const all = [...new Set(rows.flatMap((m) => JSON.parse(m.mentions || '[]')))];
  const byId = new Map(names(all).map((u) => [u.id, u.name]));
  return Promise.all(rows.map(async ({ group_id, image_key, mentions, hashtags, ...m }) => ({
    ...m,
    body: m.deleted ? null : m.body,
    image_url: m.deleted ? null : await storage.signGet(image_key),
    mentions: JSON.parse(mentions || '[]').map((id) => ({ id, name: byId.get(id) ?? '' })),
    hashtags: JSON.parse(hashtags || '[]'),
  })));
}
const one = async (id) => (await format([db.prepare(`${ROW_SQL} WHERE m.id = ?`).get(id)]))[0];

// message in the caller's room, else 404/403 → null
function owned(req, res, gid) {
  const m = db.prepare('SELECT id, group_id, user_id FROM chat_messages WHERE id = ?').get(req.params.id);
  if (!m) { res.status(404).json({ error: 'الرسالة غير موجودة' }); return null; }
  if (m.group_id !== gid) { res.status(403).json(FORBIDDEN); return null; }
  return m;
}

r.get('/chat/messages', wrap(async (req, res) => {
  const gid = room(req, res);
  if (!gid) return;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const where = ['m.group_id = ?'], args = [gid];
  if (Number(req.query.before)) { where.push('m.id < ?'); args.push(Number(req.query.before)); }
  if (req.query.tag) { where.push('EXISTS (SELECT 1 FROM json_each(m.hashtags) WHERE value = ?)'); args.push(String(req.query.tag).toLowerCase()); }
  if (req.query.q) { where.push("m.deleted = 0 AND m.body LIKE '%' || ? || '%'"); args.push(String(req.query.q)); }
  const rows = db.prepare(`${ROW_SQL} WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT ?`).all(...args, limit + 1);
  const more = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  res.json({ items: await format(page), next: more && page.length ? page[0].id : null });
}));

const MENTION_RE = /@([\p{L}\p{N}_.-]+)/gu;
const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu;

r.post('/chat/messages', wrap(async (req, res) => {
  const gid = room(req, res);
  if (!gid) return;
  const me = req.user, b = req.body || {};
  const body = String(b.body ?? '').trim();
  const image_key = b.image_key ? String(b.image_key) : null;
  if (!body && !image_key) return res.status(400).json({ error: 'اكتب رسالة أو أرفق صورة' });
  if (body.length > 2000) return res.status(400).json({ error: 'الرسالة طويلة جدًا (حتى 2000 حرف)' });
  if (image_key && !image_key.startsWith(`chat/${gid}/`)) return res.status(400).json({ error: 'مفتاح الصورة غير صالح' });

  const users = roomUsers(gid);
  const tokens = [...body.matchAll(MENTION_RE)].map((x) => x[1]);
  const mentions = tokens.includes('all')
    ? users.filter((u) => u.id !== me.id).map((u) => u.id)
    : [...new Set(users.filter((u) => tokens.includes(u.username)).map((u) => u.id))];
  const hashtags = [...new Set([...body.matchAll(HASHTAG_RE)].map((x) => x[1].toLowerCase()))];

  const id = db.prepare('INSERT INTO chat_messages (group_id, user_id, body, image_key, mentions, hashtags) VALUES (?,?,?,?,?,?)')
    .run(gid, me.id, body || null, image_key, JSON.stringify(mentions), JSON.stringify(hashtags)).lastInsertRowid;
  const row = await one(id);
  sse.broadcastToGroup(gid, 'message', row);

  const preview = (body || '📷 صورة').slice(0, 120);
  const mentioned = mentions.filter((uid) => uid !== me.id);
  for (const uid of mentioned)
    notify([uid], { key: `mention:${id}:${uid}`, kind: 'mention', title: `إشارة إليك في المحادثة: ${row.user_name}`, body: preview, link: `/chat?m=${id}` });
  // everyone else who isn't watching the room: one collapsed OS notification per group (no in-app rows)
  const offline = users.filter((u) => u.id !== me.id && !mentioned.includes(u.id) && !sse.isOnline(u.id)).map((u) => u.id);
  if (offline.length)
    push(offline, { key: `chat:${gid}`, kind: 'message', title: 'رسائل جديدة في محادثة الفريق', body: preview, link: '/chat' }).catch((e) => console.warn('push:', e.message));
  res.json(row);
}));

r.delete('/chat/messages/:id', (req, res) => {
  const gid = room(req, res);
  if (!gid) return;
  const m = owned(req, res, gid);
  if (!m) return;
  if (m.user_id !== req.user.id && req.user.role === 'user') return res.status(403).json(FORBIDDEN);
  db.prepare('UPDATE chat_messages SET deleted = 1, body = NULL, image_key = NULL WHERE id = ?').run(m.id);
  sse.broadcastToGroup(gid, 'deleted', { id: m.id });
  res.json({ ok: true });
});

r.put('/chat/messages/:id/pin', requireRole('admin', 'super'), (req, res) => {
  const gid = room(req, res);
  if (!gid) return;
  const m = owned(req, res, gid);
  if (!m) return;
  const pinned = Number(req.body?.pinned) ? 1 : 0;
  db.prepare('UPDATE chat_messages SET pinned = ? WHERE id = ?').run(pinned, m.id);
  sse.broadcastToGroup(gid, 'pinned', { id: m.id, pinned });
  res.json({ id: m.id, pinned });
});

r.get('/chat/pinned', wrap(async (req, res) => {
  const gid = room(req, res);
  if (gid) res.json(await format(db.prepare(`${ROW_SQL} WHERE m.group_id = ? AND m.pinned = 1 AND m.deleted = 0 ORDER BY m.id DESC LIMIT 10`).all(gid)));
}));

// ---- upload → B2 ----
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (q, f, cb) => cb(null, !!EXT[f.mimetype]) }).single('file');

r.post('/chat/upload', (req, res, next) => {
  const gid = room(req, res);
  if (!gid) return;
  if (!storage.enabled) return res.status(503).json({ error: 'رفع الصور غير مفعّل على الخادم' });
  upload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'حجم الصورة يتجاوز 5 ميغابايت' : 'تعذّر استلام الملف' });
    if (!req.file) return res.status(400).json({ error: 'أرفق صورة بصيغة JPG أو PNG أو WebP أو GIF' });
    const image_key = `chat/${gid}/${crypto.randomUUID()}.${EXT[req.file.mimetype]}`;
    storage.putImage(image_key, req.file.buffer, req.file.mimetype)
      .then(async () => res.json({ image_key, image_url: await storage.signGet(image_key) }))
      .catch(next);
  });
});

// ---- room meta ----
r.get('/chat/members', (req, res) => {
  const gid = room(req, res);
  if (!gid) return;
  const online = new Set(sse.onlineIds(gid));
  res.json(roomUsers(gid).map((u) => ({ ...u, online: online.has(u.id) })));
});

r.get('/chat/tags', (req, res) => {
  const gid = room(req, res);
  if (gid) res.json(db.prepare(`SELECT j.value AS tag, COUNT(*) AS count FROM chat_messages m, json_each(m.hashtags) j
    WHERE m.group_id = ? AND m.deleted = 0 AND m.created_at >= datetime('now', '-30 days')
    GROUP BY j.value ORDER BY count DESC, tag LIMIT 15`).all(gid));
});

r.put('/chat/read', (req, res) => {
  const last = Number(req.body?.last_id);
  if (!Number.isInteger(last) || last < 0) return res.status(400).json({ error: 'معرّف الرسالة غير صالح' });
  db.prepare('INSERT INTO chat_reads (user_id, last_read_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_read_id = max(last_read_id, excluded.last_read_id)').run(req.user.id, last);
  res.json({ ok: true });
});

module.exports = r;
