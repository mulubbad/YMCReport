const express = require('express');
const db = require('../db');
const { auth, requireRole } = require('../auth');
const { notify } = require('../notify');

const r = express.Router();
r.use(auth);

// profile fields a user may request to change; everything else stays admin-managed
const REQUESTABLE = ['name', 'username'];
const FIELD_AR = { name: 'الاسم', username: 'اسم المستخدم' };

const REQUEST_SQL = `SELECT r.*, u.name AS user_name, u.username AS user_username, rv.name AS reviewer_name
  FROM profile_requests r JOIN users u ON u.id = r.user_id LEFT JOIN users rv ON rv.id = r.reviewed_by`;
const parse = (row) => ({ ...row, changes: JSON.parse(row.changes) });

// user -> own history; super -> everyone's
r.get('/profile/requests', (req, res) => {
  const rows = req.user.role === 'super'
    ? db.prepare(`${REQUEST_SQL} ORDER BY r.id DESC LIMIT 200`).all()
    : db.prepare(`${REQUEST_SQL} WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 200`).all(req.user.id);
  res.json(rows.map(parse));
});

r.post('/profile/requests', (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (me.role === 'super') return res.status(400).json({ error: 'المشرف العام يعدّل بياناته مباشرة دون طلب' });
  if (db.prepare("SELECT 1 FROM profile_requests WHERE user_id = ? AND status = 'pending'").get(me.id))
    return res.status(400).json({ error: 'لديك طلب تعديل قيد المراجعة بالفعل — انتظر البتّ فيه أولًا' });

  const b = req.body || {};
  const changes = {};
  for (const f of REQUESTABLE) {
    const v = typeof b[f] === 'string' ? b[f].trim() : null;
    if (v && v !== me[f]) changes[f] = { from: me[f], to: v };
  }
  if (!Object.keys(changes).length) return res.status(400).json({ error: 'لا توجد تغييرات لإرسالها' });
  if (changes.username && db.prepare('SELECT 1 FROM users WHERE username = ?').get(changes.username.to))
    return res.status(400).json({ error: 'اسم المستخدم مستخدم بالفعل' });

  const id = db.prepare('INSERT INTO profile_requests (user_id, changes) VALUES (?, ?)')
    .run(me.id, JSON.stringify(changes)).lastInsertRowid;
  // recipients: notify() copies every active super on profile_request
  notify([], {
    key: `profile_request:${id}`, kind: 'profile_request',
    title: `طلب تعديل بيانات من ${me.name}`,
    body: Object.entries(changes).map(([f, c]) => `${FIELD_AR[f]}: ${c.from} ← ${c.to}`).join('، '),
    link: '/users',
  });
  res.json(parse(db.prepare(`${REQUEST_SQL} WHERE r.id = ?`).get(id)));
});

r.put('/profile/requests/:id', requireRole('super'), (req, res) => {
  const row = db.prepare(`${REQUEST_SQL} WHERE r.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'تم البتّ في هذا الطلب مسبقًا' });
  const { status, note } = req.body || {};
  if (!['approved', 'declined'].includes(status)) return res.status(400).json({ error: 'الحالة غير صالحة' });

  const changes = JSON.parse(row.changes);
  if (status === 'approved') {
    const fields = Object.keys(changes).filter((f) => REQUESTABLE.includes(f));
    try {
      db.prepare(`UPDATE users SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`)
        .run(...fields.map((f) => changes[f].to), row.user_id);
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(400).json({ error: 'اسم المستخدم مستخدم بالفعل' });
      throw e;
    }
  }
  db.prepare(`UPDATE profile_requests SET status = ?, note = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`)
    .run(status, (note || '').trim() || null, req.user.id, row.id);
  notify([row.user_id], {
    key: `profile_reviewed:${row.id}`, kind: 'profile_reviewed',
    title: status === 'approved' ? 'تمت الموافقة على طلب تعديل بياناتك' : 'تم رفض طلب تعديل بياناتك',
    body: (note || '').trim() || null,
    link: '/profile',
  });
  res.json(parse(db.prepare(`${REQUEST_SQL} WHERE r.id = ?`).get(row.id)));
});

module.exports = r;
