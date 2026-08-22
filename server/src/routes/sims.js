const express = require('express');
const db = require('../db');
const { auth } = require('../auth');

const r = express.Router();
r.use(auth);

const STATUSES = ['active', 'inactive', 'lost'];
const STATUS_AR = { active: 'نشط', inactive: 'غير نشط', lost: 'مفقود' };
const CARRIER_AR = { jawwal: 'جوال', ooredoo: 'أوريدو' };
const FORBIDDEN = { error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' };
const NOT_FOUND = { error: 'الخط غير موجود' };
const BAD_NUMBER = 'رقم الجوال غير صالح — يجب أن يبدأ بـ 059 (جوال) أو 056 (أوريدو)';

// '+970 59-123-4567' | '00972561234567' | '0591234567' -> '05XXXXXXXX'; null when not a Jawwal/Ooredoo number
function normalizeNumber(raw) {
  const s = String(raw ?? '').replace(/[\s\-()]/g, '').replace(/^(\+|00)?97[02]/, '0');
  return /^05[69]\d{7}$/.test(s) ? s : null;
}
const carrierOf = (n) => (n[2] === '9' ? 'jawwal' : 'ooredoo');

// accounts' mobiles -> Map(normalized number -> count). ponytail: JS-side normalize, data is small
const linkedCounts = (rows) => rows.reduce((m, { mobile }) => {
  const n = normalizeNumber(mobile);
  return n ? m.set(n, (m.get(n) || 0) + 1) : m;
}, new Map());

// scope like /accounts: user -> own, admin -> group (+?user_id), super -> all (+?group_id/?user_id). `t` = row alias, owner joined as `u`
function scopeWhere(me, query, t) {
  const where = [], args = [];
  if (me.role === 'user') { where.push(`${t}.user_id = ?`); args.push(me.id); }
  else {
    if (me.role === 'admin') { where.push('u.group_id = ?'); args.push(me.group_id); }
    else if (query.group_id) { where.push('u.group_id = ?'); args.push(query.group_id); }
    if (query.user_id) { where.push(`${t}.user_id = ?`); args.push(query.user_id); }
  }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
}

const SIM_SQL = `SELECT s.*, u.name AS owner_name, u.group_id AS owner_group,
  (SELECT COUNT(*) FROM entity_notes n WHERE n.entity_type = 'sim' AND n.entity_id = s.id) AS note_count
  FROM sim_lines s JOIN users u ON u.id = s.user_id`;
const getSim = (id) => db.prepare(`${SIM_SQL} WHERE s.id = ?`).get(id);

const canAccess = (me, sim) =>
  me.role === 'super' || (me.role === 'admin' ? sim.owner_group === me.group_id : sim.user_id === me.id);

function withLinked(me, query, rows) {
  const a = scopeWhere(me, query, 'a');
  const n = linkedCounts(db.prepare(`SELECT a.mobile FROM accounts a JOIN users u ON u.id = a.user_id ${a.sql}`).all(...a.args));
  return rows.map(({ owner_group, ...x }) => ({ ...x, linked_accounts: n.get(x.number) || 0 }));
}

// body over base row -> {number, carrier, status, holder_name, notes}, or an Arabic error string
function build(b, base) {
  const number = 'number' in b ? normalizeNumber(b.number) : base.number;
  if (!number) return BAD_NUMBER;
  const status = b.status ?? base.status ?? 'active';
  if (!STATUSES.includes(status)) return 'الحالة غير صالحة';
  const str = (f) => (f in b ? b[f] : base[f]) ?? null;
  return { number, carrier: carrierOf(number), status, holder_name: str('holder_name'), notes: str('notes') };
}

// UNIQUE(user_id, number) -> 400 with the contract message
const unique = (res, fn) => {
  try { return fn(); } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') { res.status(400).json({ error: 'هذا الرقم مسجّل مسبقًا' }); return null; }
    throw e;
  }
};

r.get('/sims', (req, res) => {
  const s = scopeWhere(req.user, req.query, 's');
  const rows = db.prepare(`${SIM_SQL} ${s.sql} ORDER BY s.created_at DESC`).all(...s.args);
  res.json(withLinked(req.user, req.query, rows));
});

r.post('/sims', (req, res) => {
  const b = req.body || {};
  const me = req.user;
  let userId = me.id;
  if (b.user_id && b.user_id !== me.id) {
    if (me.role === 'user') return res.status(403).json(FORBIDDEN);
    const target = db.prepare('SELECT id, group_id FROM users WHERE id = ?').get(b.user_id);
    if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (me.role === 'admin' && target.group_id !== me.group_id) return res.status(403).json(FORBIDDEN);
    userId = target.id;
  }
  const v = build(b, {});
  if (typeof v === 'string') return res.status(400).json({ error: v });
  const id = unique(res, () => db.prepare('INSERT INTO sim_lines (user_id, number, carrier, status, holder_name, notes) VALUES (?,?,?,?,?,?)')
    .run(userId, v.number, v.carrier, v.status, v.holder_name, v.notes).lastInsertRowid);
  if (id != null) res.json(withLinked(me, {}, [getSim(id)])[0]);
});

r.put('/sims/:id', (req, res) => {
  const sim = getSim(req.params.id);
  if (!sim) return res.status(404).json(NOT_FOUND);
  if (!canAccess(req.user, sim)) return res.status(403).json(FORBIDDEN);
  const v = build(req.body || {}, sim);
  if (typeof v === 'string') return res.status(400).json({ error: v });
  const ok = unique(res, () => db.prepare(`UPDATE sim_lines SET number = ?, carrier = ?, status = ?, holder_name = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(v.number, v.carrier, v.status, v.holder_name, v.notes, sim.id));
  if (ok) res.json(withLinked(req.user, {}, [getSim(sim.id)])[0]);
});

r.delete('/sims/:id', (req, res) => {
  const sim = getSim(req.params.id);
  if (!sim) return res.status(404).json(NOT_FOUND);
  if (!canAccess(req.user, sim)) return res.status(403).json(FORBIDDEN);
  db.prepare('DELETE FROM sim_lines WHERE id = ?').run(sim.id);
  res.json({ ok: true });
});

module.exports = r;
module.exports.normalizeNumber = normalizeNumber;
module.exports.linkedCounts = linkedCounts;
module.exports.STATUS_AR = STATUS_AR;
module.exports.CARRIER_AR = CARRIER_AR;
