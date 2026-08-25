const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const { auth, requireRole } = require('../auth');
const { members, taskDone } = require('./tasks');
const { STATUS_AR, EVENT_AR } = require('./accounts');
const { STATUS_AR: SIM_STATUS_AR, CARRIER_AR, linkedCounts } = require('./sims');

const r = express.Router();

const csvNums = (s) => (s ? String(s).split(',').map(Number).filter(Number.isFinite) : null);

const KIND_AR = { publish: 'نشر', create_account: 'إنشاء حساب', interact: 'تفاعل', general: 'عام' };
const PRIORITY_AR = { low: 'منخفضة', normal: 'عادية', high: 'عالية' };
const ACTION_AR = { react: 'إعجاب', comment: 'تعليق', share_profile: 'مشاركة', share_group: 'مشاركة في مجموعة', follow: 'متابعة' };

const col = (header, width) => ({ header, width });
const ts = (s) => (s ? String(s).slice(0, 16) : s); // 'YYYY-MM-DD HH:MM'
const yesNo = (v) => (v ? 'نعم' : 'لا');
const TRACK_COLS = [col('الحالة', 10), col('المتابعون', 11), col('عدد المنشورات', 12), col('آخر فحص', 20)];
const track = (x) => [STATUS_AR[x.status] ?? x.status, x.followers, x.posts_count, ts(x.last_checked_at)];

// WHERE builder over the shared filters q = {gid, userIds, typeIds, from, to}
function frag(q) {
  const where = [], args = [];
  return {
    args,
    in(c, ids) { if (ids) { where.push(`${c} IN (${ids.map(() => '?').join(',')})`); args.push(...ids); } },
    eq(c, v) { if (v != null) { where.push(`${c} = ?`); args.push(v); } },
    dates(c) {
      if (q.from) { where.push(`date(${c}) >= date(?)`); args.push(q.from); }
      if (q.to) { where.push(`date(${c}) <= date(?)`); args.push(q.to); }
    },
    sql: () => (where.length ? 'WHERE ' + where.join(' AND ') : ''),
  };
}

// sheet builders: q -> { title, columns: [{header, width}], rows: [[cell, ...]] }; object order = xlsx sheet order
const SHEETS = {
  accounts(q) {
    const f = frag(q);
    f.eq('u.group_id', q.gid); f.in('acc.user_id', q.userIds); f.in('acc.type_id', q.typeIds);
    const rows = db.prepare(`
      SELECT u.name owner, t.name type, s.name site, acc.name, acc.mobile, acc.email, acc.password, acc.link,
             acc.profile_address, acc.profile_work,
             (SELECT COUNT(*) FROM pages p WHERE p.account_id = acc.id) pages,
             acc.status, acc.followers, acc.posts_count, acc.last_checked_at, acc.notes, acc.created_at
      FROM accounts acc JOIN users u ON u.id = acc.user_id JOIN account_types t ON t.id = acc.type_id
      LEFT JOIN sites s ON s.id = acc.site_id ${f.sql()} ORDER BY u.name, acc.name`).all(...f.args);
    return {
      title: 'الحسابات',
      columns: [col('المالك', 20), col('النوع', 14), col('الموقع', 16), col('اسم الحساب', 24), col('رقم الجوال', 16),
        col('البريد الإلكتروني', 26), col('كلمة المرور', 16), col('الرابط', 30), col('المنطقة الجغرافية للحساب', 22),
        col('طبيعة عمل صاحب الحساب', 22), col('الصفحات', 8), ...TRACK_COLS, col('ملاحظات', 30), col('تاريخ الإنشاء', 20)],
      rows: rows.map((x) => [x.owner, x.type, x.site, x.name, x.mobile, x.email, x.password, x.link, x.profile_address,
        x.profile_work, x.pages, ...track(x), x.notes, ts(x.created_at)]),
    };
  },

  pages(q) {
    const f = frag(q);
    f.eq('u.group_id', q.gid); f.in('acc.user_id', q.userIds); f.in('acc.type_id', q.typeIds);
    const rows = db.prepare(`
      SELECT u.name owner, acc.name account, t.name type, p.name, p.url, p.address, p.work,
             p.status, p.followers, p.posts_count, p.last_checked_at, p.note
      FROM pages p JOIN accounts acc ON acc.id = p.account_id JOIN users u ON u.id = acc.user_id
      JOIN account_types t ON t.id = acc.type_id ${f.sql()} ORDER BY u.name, acc.name, p.name`).all(...f.args);
    return {
      title: 'الصفحات',
      columns: [col('المالك', 20), col('الحساب', 24), col('النوع', 14), col('اسم الصفحة', 24), col('الرابط', 30),
        col('العنوان', 22), col('العمل', 22), ...TRACK_COLS, col('ملاحظات', 30)],
      rows: rows.map((x) => [x.owner, x.account, x.type, x.name, x.url, x.address, x.work, ...track(x), x.note]),
    };
  },

  events(q) {
    const f = frag(q);
    f.eq('u.group_id', q.gid); f.in('acc.user_id', q.userIds); f.in('acc.type_id', q.typeIds); f.dates('e.created_at');
    const rows = db.prepare(`
      SELECT e.created_at, acc.name account, p.name page, actor.name user, e.kind, e.summary
      FROM account_events e JOIN accounts acc ON acc.id = e.account_id JOIN users u ON u.id = acc.user_id
      LEFT JOIN pages p ON p.id = e.page_id LEFT JOIN users actor ON actor.id = e.user_id
      ${f.sql()} ORDER BY e.id DESC`).all(...f.args);
    return {
      title: 'سجل التحديثات',
      columns: [col('التاريخ', 20), col('الحساب', 24), col('الصفحة', 20), col('المستخدم', 20), col('النوع', 16), col('الوصف', 48)],
      rows: rows.map((x) => [ts(x.created_at), x.account, x.page, x.user, EVENT_AR[x.kind] ?? x.kind, x.summary]),
    };
  },

  sims(q) {
    const f = frag(q);
    f.eq('u.group_id', q.gid); f.in('s.user_id', q.userIds);
    const rows = db.prepare(`SELECT u.name owner, s.* FROM sim_lines s JOIN users u ON u.id = s.user_id
      ${f.sql()} ORDER BY u.name, s.number`).all(...f.args);
    const a = frag(q);
    a.eq('u.group_id', q.gid); a.in('acc.user_id', q.userIds);
    const linked = linkedCounts(db.prepare(`SELECT acc.mobile FROM accounts acc JOIN users u ON u.id = acc.user_id ${a.sql()}`).all(...a.args));
    return {
      title: 'خطوط الاتصال',
      columns: [col('المالك', 20), col('الرقم', 14), col('الشركة', 10), col('الحالة', 10), col('اسم المالك المسجّل', 22),
        col('الحسابات المرتبطة', 12), col('ملاحظات', 30), col('أضيف في', 20)],
      rows: rows.map((x) => [x.owner, x.number, CARRIER_AR[x.carrier] ?? x.carrier, SIM_STATUS_AR[x.status] ?? x.status,
        x.holder_name, linked.get(x.number) || 0, x.notes, ts(x.created_at)]),
    };
  },

  tasks(q) {
    const f = frag(q);
    f.eq('t.group_id', q.gid); f.dates('t.created_at');
    const rows = db.prepare(`SELECT t.*, ty.name AS type_name,
      (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_count
      FROM tasks t LEFT JOIN account_types ty ON ty.id = t.type_id ${f.sql()} ORDER BY t.created_at DESC`).all(...f.args);
    return {
      title: 'المهام',
      columns: [col('العنوان', 32), col('نوع المهمة', 16), col('النوع المستهدف', 14), col('عدد المنشورات', 12), col('الفئة', 16),
        col('الأولوية', 10), col('تاريخ الاستحقاق', 16), col('المهام الفرعية', 10), col('المنجز/الإجمالي', 12),
        col('نسبة الإنجاز %', 14), col('مؤرشفة', 8)],
      rows: rows.map((t) => {
        const ids = members(t.group_id), done = taskDone(t.id, ids);
        return [t.title, KIND_AR[t.kind] ?? t.kind, t.type_name, t.post_count, t.category, PRIORITY_AR[t.priority] ?? t.priority,
          t.due_date, t.subtask_count, `${done}/${ids.length}`, ids.length ? Math.round((done * 100) / ids.length) : 0, yesNo(t.archived)];
      }),
    };
  },

  interactions(q) {
    const f = frag(q);
    f.eq('t.group_id', q.gid); f.in('i.user_id', q.userIds); f.dates('i.updated_at');
    const rows = db.prepare(`
      SELECT t.title task, s.title subtask, u.name user, i.done, i.actions_done, i.notes, i.day, i.updated_at
      FROM interactions i JOIN tasks t ON t.id = i.task_id JOIN users u ON u.id = i.user_id
      LEFT JOIN subtasks s ON s.id = i.subtask_id ${f.sql()} ORDER BY t.title, i.day DESC, u.name`).all(...f.args);
    return {
      title: 'التفاعلات',
      columns: [col('المهمة', 32), col('المهمة الفرعية', 28), col('المستخدم', 20), col('منجز', 8),
        col('اليوم', 14), col('الإجراءات المنفذة', 28), col('ملاحظات', 32), col('آخر تحديث', 20)],
      rows: rows.map((x) => [x.task, x.subtask, x.user, yesNo(x.done), x.day || '—',
        JSON.parse(x.actions_done || '[]').map((k) => ACTION_AR[k] ?? k).join('، '), x.notes, ts(x.updated_at)]),
    };
  },

  summary(q) {
    const uf = frag(q);
    uf.eq('group_id', q.gid); uf.in('id', q.userIds); uf.eq('role', 'user');
    const scopedUsers = db.prepare(`SELECT * FROM users ${uf.sql()} ORDER BY name`).all(...uf.args);
    const tf = frag(q);
    tf.eq('group_id', q.gid); tf.in('id', q.typeIds);
    const types = db.prepare(`SELECT * FROM account_types ${tf.sql()} ORDER BY name`).all(...tf.args);

    const groupTasks = new Map(); // group_id -> tasks (date-filtered)
    const tasksFor = (g) => {
      if (!groupTasks.has(g)) {
        const f = frag(q);
        f.eq('group_id', g); f.dates('created_at');
        groupTasks.set(g, db.prepare(`SELECT id FROM tasks ${f.sql()}`).all(...f.args));
      }
      return groupTasks.get(g);
    };
    return {
      title: 'الملخص',
      columns: [col('الاسم', 22), col('الحسابات', 10), ...types.map((t) => col(t.name, 12)),
        col('المهام المنجزة/الإجمالي', 16), col('نسبة الإنجاز %', 14)],
      rows: scopedUsers.map((u) => {
        const counts = new Map(db.prepare('SELECT type_id, COUNT(*) c FROM accounts WHERE user_id = ? GROUP BY type_id').all(u.id)
          .map((x) => [x.type_id, x.c]));
        const tasks = u.group_id ? tasksFor(u.group_id) : [];
        const done = tasks.reduce((n, t) => n + taskDone(t.id, [u.id]), 0);
        return [u.name, types.reduce((n, t) => n + (counts.get(t.id) || 0), 0), ...types.map((t) => counts.get(t.id) || 0),
          `${done}/${tasks.length}`, tasks.length ? Math.round((done * 100) / tasks.length) : 0];
      }),
    };
  },
};

// shared filters; admin pinned to own group, null gid = all groups (super only). Sends 403 + returns null when unscoped.
function scope(req, res) {
  const gid = req.user.role === 'admin' ? req.user.group_id : (req.query.group_id ? Number(req.query.group_id) : null);
  if (gid == null && req.user.role !== 'super') { res.status(403).json({ error: 'لا توجد مجموعة مرتبطة بحسابك' }); return null; }
  return { gid, userIds: csvNums(req.query.user_ids), typeIds: csvNums(req.query.type_ids), from: req.query.from, to: req.query.to };
}

r.get('/export', auth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const q = scope(req, res);
    if (!q) return;
    const sheets = String(req.query.sheets || Object.keys(SHEETS).join(',')).split(',');
    const wb = new ExcelJS.Workbook();
    for (const key of Object.keys(SHEETS)) {
      if (!sheets.includes(key)) continue;
      const { title, columns, rows } = SHEETS[key](q);
      const ws = wb.addWorksheet(title);
      ws.columns = columns;
      for (const row of rows) ws.addRow(row);
      ws.getRow(1).eachCell((c) => {
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
      });
      ws.views = [{ state: 'frozen', ySplit: 1, rightToLeft: true }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="report-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    next(e);
  }
});

// same sheets as the xlsx, as JSON for the report screen's live preview
r.get('/report', auth, requireRole('admin', 'super'), (req, res) => {
  const sheet = String(req.query.sheet || '');
  if (!Object.hasOwn(SHEETS, sheet)) return res.status(400).json({ error: 'ورقة غير معروفة' });
  const q = scope(req, res);
  if (!q) return;
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 2000);
  const { title, columns, rows } = SHEETS[sheet](q);
  res.json({ sheet, title, columns: columns.map((c) => c.header), rows: rows.slice(0, limit), total: rows.length });
});

module.exports = r;
