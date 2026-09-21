const express = require('express');
const db = require('../db');
const { auth, requireRole, scopeGid, canManage, FORBIDDEN } = require('../auth');

const r = express.Router();

// update cadence presets shown in the UI; the server accepts any integer 0..365 (0 = never due)
const UPDATE_DAYS_AR = { 0: 'بدون تحديث دوري', 1: 'يومياً', 2: 'كل يومين', 3: 'كل 3 أيام', 7: 'أسبوعياً', 14: 'كل أسبوعين', 30: 'شهرياً' };

// types and sites are the same CRUD shape, different columns
for (const { table, route, values, check } of [
  { table: 'account_types',
    route: 'types',
    values: (b) => ({ name: b.name, allows_pages: b.allows_pages ? 1 : 0, update_days: Number(b.update_days ?? 1) }),
    // Number('abc'/{}) is NaN and Number.isInteger rejects it, so a junk body 400s instead of storing NULL-ish
    check: (v) => (Number.isInteger(v.update_days) && v.update_days >= 0 && v.update_days <= 365
      ? null
      : 'دورية التحديث يجب أن تكون عددًا صحيحًا بين 0 و365 يومًا') },
  { table: 'sites', route: 'sites', values: (b) => ({ name: b.name, url: b.url ?? null }) },
]) {
  r.get(`/${route}`, auth, (req, res) => {
    const gid = scopeGid(req, res);
    if (gid === false) return;
    // groupless non-super sees nothing, not everything
    if (!gid && req.user.role !== 'super') return res.json([]);
    res.json(gid
      ? db.prepare(`SELECT * FROM ${table} WHERE group_id = ? ORDER BY name`).all(gid)
      : db.prepare(`SELECT * FROM ${table} ORDER BY name`).all());
  });

  r.post(`/${route}`, auth, requireRole('admin', 'super'), (req, res) => {
    const b = req.body || {};
    const gid = req.user.role === 'admin' ? scopeGid(req, res) : b.group_id;
    if (gid === false) return;
    if (!gid) return res.status(400).json({ error: 'يجب تحديد المجموعة' });
    if (!b.name) return res.status(400).json({ error: 'الاسم مطلوب' });
    const v = values(b);
    const bad = check?.(v);
    if (bad) return res.status(400).json({ error: bad });
    const keys = Object.keys(v);
    const info = db.prepare(`INSERT INTO ${table} (group_id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`)
      .run(gid, ...keys.map((k) => v[k]));
    res.json(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid));
  });

  const scoped = (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!row) { res.status(404).json({ error: 'العنصر غير موجود' }); return null; }
    if (req.user.role === 'admin' && !canManage(req.user, row.group_id)) {
      res.status(403).json(FORBIDDEN);
      return null;
    }
    return row;
  };

  r.put(`/${route}/:id`, auth, requireRole('admin', 'super'), (req, res) => {
    const row = scoped(req, res);
    if (!row) return;
    const v = values({ ...row, ...req.body });
    const bad = check?.(v);
    if (bad) return res.status(400).json({ error: bad });
    const keys = Object.keys(v);
    db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...keys.map((k) => v[k]), row.id);
    res.json(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.id));
  });

  r.delete(`/${route}/:id`, auth, requireRole('admin', 'super'), (req, res) => {
    const row = scoped(req, res);
    if (!row) return;
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.id);
    res.json({ ok: true });
  });
}

module.exports = r;
module.exports.UPDATE_DAYS_AR = UPDATE_DAYS_AR;
