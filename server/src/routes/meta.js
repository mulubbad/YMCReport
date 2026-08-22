const express = require('express');
const db = require('../db');
const { auth, requireRole } = require('../auth');

const r = express.Router();

// types and sites are the same CRUD shape, different columns
for (const { table, route, values } of [
  { table: 'account_types', route: 'types', values: (b) => ({ name: b.name, allows_pages: b.allows_pages ? 1 : 0 }) },
  { table: 'sites', route: 'sites', values: (b) => ({ name: b.name, url: b.url ?? null }) },
]) {
  r.get(`/${route}`, auth, (req, res) => {
    const gid = req.user.role === 'super' ? req.query.group_id : req.user.group_id;
    // groupless non-super sees nothing, not everything
    if (!gid && req.user.role !== 'super') return res.json([]);
    res.json(gid
      ? db.prepare(`SELECT * FROM ${table} WHERE group_id = ? ORDER BY name`).all(gid)
      : db.prepare(`SELECT * FROM ${table} ORDER BY name`).all());
  });

  r.post(`/${route}`, auth, requireRole('admin', 'super'), (req, res) => {
    const b = req.body || {};
    const gid = req.user.role === 'admin' ? req.user.group_id : b.group_id;
    if (!gid) return res.status(400).json({ error: 'يجب تحديد المجموعة' });
    if (!b.name) return res.status(400).json({ error: 'الاسم مطلوب' });
    const v = values(b);
    const keys = Object.keys(v);
    const info = db.prepare(`INSERT INTO ${table} (group_id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`)
      .run(gid, ...keys.map((k) => v[k]));
    res.json(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid));
  });

  const scoped = (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!row) { res.status(404).json({ error: 'العنصر غير موجود' }); return null; }
    if (req.user.role === 'admin' && row.group_id !== req.user.group_id) {
      res.status(403).json({ error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' });
      return null;
    }
    return row;
  };

  r.put(`/${route}/:id`, auth, requireRole('admin', 'super'), (req, res) => {
    const row = scoped(req, res);
    if (!row) return;
    const v = values({ ...row, ...req.body });
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
