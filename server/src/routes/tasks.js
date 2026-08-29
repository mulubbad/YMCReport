const express = require('express');
const db = require('../db');
const { auth, requireRole, scopeGid, canManage, FORBIDDEN } = require('../auth');
const { notify, groupAdmins, day } = require('../notify');
const { STATUS_AR } = require('./accounts');

const r = express.Router();
r.use(auth);

const KINDS = ['publish', 'create_account', 'interact', 'general'];
const PRIORITIES = ['low', 'normal', 'high'];
const KIND_AR = { publish: 'نشر', create_account: 'إنشاء حساب', interact: 'تفاعل', general: 'عام' };
const ACTIONS = ['react', 'comment', 'share_profile', 'share_group', 'follow'];
const STALE_DAYS = 14; // account unchecked this long => needs attention (UI mirrors this constant)

// team discussion per task (ponytail: table owned by this router — CREATE IF NOT EXISTS is idempotent)
db.exec(`
CREATE TABLE IF NOT EXISTS task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS ix_task_comments ON task_comments(task_id, id);`);

const parseArr = (s) => (s ? JSON.parse(s) : []);

// subtask actions from request body -> JSON string or null; false = invalid key
function actionsJson(actions) {
  if (actions == null) return null;
  if (!Array.isArray(actions) || actions.some((k) => !ACTIONS.includes(k))) return false;
  const uniq = [...new Set(actions)];
  return uniq.length ? JSON.stringify(uniq) : null;
}

// repeat fields from a request body -> {repeat, from, until} or {error}; period optional (open-ended = forever)
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function repeatFields(b) {
  if (b.repeat == null) return { repeat: null, from: null, until: null };
  if (b.repeat !== 'daily') return { error: 'نوع التكرار غير صالح' };
  const from = b.repeat_from ?? null, until = b.repeat_until ?? null;
  if ((from && !ISO_DAY.test(from)) || (until && !ISO_DAY.test(until))) return { error: 'تاريخ فترة التكرار غير صالح' };
  if (from && until && from > until) return { error: 'بداية فترة التكرار بعد نهايتها' };
  return { repeat: 'daily', from, until };
}

// active role-user members of a group — the denominator for progress/completion
const members = (gid) =>
  db.prepare("SELECT id FROM users WHERE group_id = ? AND role = 'user' AND active = 1").all(gid).map((u) => u.id);

// daily tasks: completion is per calendar day — interactions carry day = today ('' for one-off tasks),
// so "done" always means "done today" for repeat tasks and every helper below inherits that for free
const isDaily = (t) => t.repeat === 'daily';
const dayKey = (t) => (isDaily(t) ? day() : '');
const dayKeyOf = (taskId) => dayKey(db.prepare('SELECT repeat FROM tasks WHERE id = ?').get(taskId) ?? {});
const repeatActive = (t) => isDaily(t) && !t.archived
  && (!t.repeat_from || t.repeat_from.slice(0, 10) <= day())
  && (!t.repeat_until || t.repeat_until.slice(0, 10) >= day());

// consecutive completed days ending today or yesterday (all-subtasks rule applies per day)
function streak(taskId, userId) {
  const subCount = db.prepare('SELECT COUNT(*) c FROM subtasks WHERE task_id = ?').get(taskId).c;
  const days = new Set((subCount === 0
    ? db.prepare("SELECT DISTINCT day FROM interactions WHERE task_id = ? AND user_id = ? AND subtask_id IS NULL AND done = 1 AND day != ''").all(taskId, userId)
    : db.prepare(`SELECT day FROM interactions WHERE task_id = ? AND user_id = ? AND done = 1 AND subtask_id IS NOT NULL AND day != ''
                  GROUP BY day HAVING COUNT(DISTINCT subtask_id) = ?`).all(taskId, userId, subCount)).map((r) => r.day));
  let n = 0;
  let d = days.has(day()) ? day() : day(-1);
  while (days.has(d)) { n++; d = day(daysBack(d)); }
  return n;
}
// offset (in days from now) of the day BEFORE the given YYYY-MM-DD — lets streak() walk backwards with day(offset)
const daysBack = (ymd) => Math.round((Date.parse(`${ymd}T12:00:00`) - Date.now()) / 864e5) - 1;

// [{user_id, completed_at}] of memberIds who completed the task (done on task itself, or on ALL subtasks if any);
// completed_at = latest done interaction of that member; day-scoped (today) for daily tasks
function doneRows(taskId, memberIds) {
  if (!memberIds.length) return [];
  const dk = dayKeyOf(taskId);
  const subCount = db.prepare('SELECT COUNT(*) c FROM subtasks WHERE task_id = ?').get(taskId).c;
  const rows = subCount === 0
    ? db.prepare('SELECT user_id, updated_at AS completed_at FROM interactions WHERE task_id = ? AND subtask_id IS NULL AND done = 1 AND day = ?').all(taskId, dk)
    : db.prepare(`SELECT user_id, MAX(updated_at) AS completed_at FROM interactions WHERE task_id = ? AND done = 1 AND subtask_id IS NOT NULL AND day = ?
                  GROUP BY user_id HAVING COUNT(DISTINCT subtask_id) = ?`).all(taskId, dk, subCount);
  const set = new Set(memberIds);
  return rows.filter((u) => set.has(u.user_id));
}
const doneUsers = (taskId, memberIds) => doneRows(taskId, memberIds).map((u) => u.user_id);
const taskDone = (taskId, memberIds) => doneUsers(taskId, memberIds).length;

function serializeTask(t, caller) {
  // members see only their own state: peers' progress (done_ids/progress) is a group-admin permission
  const admin = caller.role !== 'user';
  const subtasks = db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY id').all(t.id);
  const mine = new Map(
    db.prepare('SELECT subtask_id, done, notes, actions_done FROM interactions WHERE task_id = ? AND user_id = ? AND day = ?')
      .all(t.id, caller.id, dayKey(t)).map((i) => [i.subtask_id ?? 0, { done: i.done, notes: i.notes, actions_done: parseArr(i.actions_done) }]));
  const ids = members(t.group_id);
  const done_ids = admin ? doneUsers(t.id, ids) : [];
  const noMine = () => ({ done: 0, notes: null, actions_done: [] });
  return {
    ...t,
    subtasks: subtasks.map((s) => ({ ...s, actions: parseArr(s.actions), mine: mine.get(s.id) ?? noMine() })),
    mine: mine.get(0) ?? noMine(),
    progress: admin ? { done: done_ids.length, total: ids.length } : { done: 0, total: 0 },
    done_ids,
    created_by_name: t.created_by ? (db.prepare('SELECT name FROM users WHERE id = ?').get(t.created_by)?.name ?? null) : null,
    comment_count: db.prepare('SELECT COUNT(*) c FROM task_comments WHERE task_id = ?').get(t.id).c,
    repeat_active: repeatActive(t) ? 1 : 0,
    my_streak: isDaily(t) ? streak(t.id, caller.id) : 0,
  };
}

const getTask = (id) => db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);

// canManage() already means "own group" for a member, "any led group" for an admin, "all" for super
const inScope = (me, task) => canManage(me, task.group_id);

r.get('/tasks', (req, res) => {
  const gid = scopeGid(req, res);
  if (gid === false) return;
  if (!gid && req.user.role !== 'super') return res.json([]);
  const archived = req.query.archived === '1' ? 1 : 0;
  const tasks = gid
    ? db.prepare('SELECT * FROM tasks WHERE group_id = ? AND archived = ? ORDER BY created_at DESC').all(gid, archived)
    : db.prepare('SELECT * FROM tasks WHERE archived = ? ORDER BY created_at DESC').all(archived);
  res.json(tasks.map((t) => serializeTask(t, req.user)));
});

r.post('/tasks', requireRole('admin', 'super'), (req, res) => {
  const b = req.body || {};
  let gid;
  if (req.user.role === 'super') gid = b.group_id;
  else if (b.group_id != null) {                       // admin naming a group explicitly: must be one they lead
    if (!canManage(req.user, b.group_id)) return res.status(403).json(FORBIDDEN);
    gid = Number(b.group_id);
  } else {
    gid = scopeGid(req, res);
    if (gid === false) return;
  }
  if (!gid) return res.status(400).json({ error: 'يجب تحديد المجموعة' });
  if (!KINDS.includes(b.kind)) return res.status(400).json({ error: 'نوع المهمة غير صالح' });
  if (!b.title) return res.status(400).json({ error: 'عنوان المهمة مطلوب' });
  if (b.priority != null && !PRIORITIES.includes(b.priority)) return res.status(400).json({ error: 'الأولوية غير صالحة' });
  if (b.type_id) {
    const type = db.prepare('SELECT * FROM account_types WHERE id = ?').get(b.type_id);
    if (!type || type.group_id !== gid) return res.status(400).json({ error: 'نوع الحساب لا يتبع هذه المجموعة' });
  }
  for (const s of b.subtasks || []) if (actionsJson(s.actions) === false)
    return res.status(400).json({ error: 'إجراء غير صالح' });
  const rep = repeatFields(b);
  if (rep.error) return res.status(400).json({ error: rep.error });
  const id = db.transaction(() => {
    const info = db.prepare(`INSERT INTO tasks (group_id, kind, title, description, type_id, post_count, category, priority, due_date, repeat, repeat_from, repeat_until, created_by)
                             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(gid, b.kind, b.title, b.description ?? null, b.type_id ?? null, b.post_count ?? null,
        b.category ?? null, b.priority ?? 'normal', rep.repeat ? null : (b.due_date ?? null), rep.repeat, rep.from, rep.until, req.user.id);
    const ins = db.prepare('INSERT INTO subtasks (task_id, title, url, actions) VALUES (?,?,?,?)');
    for (const s of b.subtasks || []) if (s.title) ins.run(info.lastInsertRowid, s.title, s.url ?? null, actionsJson(s.actions));
    return info.lastInsertRowid;
  })();
  // everyone in the room: the group's own users + admins who lead it from another default group
  notify(db.prepare(`SELECT id FROM users WHERE active = 1 AND id != ?
    AND (group_id = ? OR id IN (SELECT user_id FROM admin_groups WHERE group_id = ?))`).all(req.user.id, gid, gid).map((u) => u.id), {
    key: `task:${id}:new`, kind: 'task_new', title: `مهمة جديدة: ${b.title}`,
    body: [KIND_AR[b.kind], rep.repeat ? 'مهمة يومية متكررة' : b.due_date && `الاستحقاق ${b.due_date}`].filter(Boolean).join('، '), link: '/tasks',
  }, req.user.id);
  res.json(serializeTask(getTask(id), req.user));
});

r.put('/tasks/:id', requireRole('admin', 'super'), (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'المهمة غير موجودة' });
  if (!inScope(req.user, task)) return res.status(403).json({ error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' });
  const b = req.body || {};
  if (b.kind && !KINDS.includes(b.kind)) return res.status(400).json({ error: 'نوع المهمة غير صالح' });
  if (b.priority != null && !PRIORITIES.includes(b.priority)) return res.status(400).json({ error: 'الأولوية غير صالحة' });
  const type_id = 'type_id' in b ? b.type_id : task.type_id;
  if (type_id && type_id !== task.type_id) {
    const type = db.prepare('SELECT * FROM account_types WHERE id = ?').get(type_id);
    if (!type || type.group_id !== task.group_id) return res.status(400).json({ error: 'نوع الحساب لا يتبع هذه المجموعة' });
  }
  for (const s of b.subtasks || []) if (actionsJson(s.actions) === false)
    return res.status(400).json({ error: 'إجراء غير صالح' });
  const rep = 'repeat' in b ? repeatFields(b) : { repeat: task.repeat, from: task.repeat_from, until: task.repeat_until };
  if (rep.error) return res.status(400).json({ error: rep.error });
  db.transaction(() => {
    db.prepare('UPDATE tasks SET kind = ?, title = ?, description = ?, type_id = ?, post_count = ?, category = ?, priority = ?, due_date = ?, repeat = ?, repeat_from = ?, repeat_until = ? WHERE id = ?')
      .run(b.kind ?? task.kind, b.title ?? task.title,
        'description' in b ? b.description : task.description, type_id,
        'post_count' in b ? b.post_count : task.post_count,
        'category' in b ? b.category : task.category,
        b.priority ?? task.priority,
        rep.repeat ? null : ('due_date' in b ? b.due_date : task.due_date),
        rep.repeat, rep.from, rep.until, task.id);
    if (Array.isArray(b.subtasks)) {
      const existing = new Set(db.prepare('SELECT id FROM subtasks WHERE task_id = ?').all(task.id).map((s) => s.id));
      const keep = [];
      for (const s of b.subtasks) {
        if (!s.title) continue;
        const actions = actionsJson(s.actions);
        if (s.id && existing.has(s.id)) {
          db.prepare('UPDATE subtasks SET title = ?, url = ?, actions = ? WHERE id = ?').run(s.title, s.url ?? null, actions, s.id);
          keep.push(s.id);
        } else {
          keep.push(db.prepare('INSERT INTO subtasks (task_id, title, url, actions) VALUES (?,?,?,?)')
            .run(task.id, s.title, s.url ?? null, actions).lastInsertRowid);
        }
      }
      db.prepare(`DELETE FROM subtasks WHERE task_id = ? ${keep.length ? `AND id NOT IN (${keep.map(() => '?').join(',')})` : ''}`)
        .run(task.id, ...keep);
    }
  })();
  res.json(serializeTask(getTask(task.id), req.user));
});

r.put('/tasks/:id/archive', requireRole('admin', 'super'), (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'المهمة غير موجودة' });
  if (!inScope(req.user, task)) return res.status(403).json({ error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' });
  db.prepare('UPDATE tasks SET archived = ? WHERE id = ?').run(req.body?.archived ? 1 : 0, task.id);
  res.json(serializeTask(getTask(task.id), req.user));
});

r.delete('/tasks/:id', requireRole('admin', 'super'), (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'المهمة غير موجودة' });
  if (!inScope(req.user, task)) return res.status(403).json({ error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  res.json({ ok: true });
});

r.get('/tasks/:id/interactions', requireRole('admin', 'super'), (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'المهمة غير موجودة' });
  if (!inScope(req.user, task)) return res.status(403).json({ error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' });
  res.json(db.prepare(`
    SELECT i.*, u.name AS user_name, s.title AS subtask_title
    FROM interactions i JOIN users u ON u.id = i.user_id LEFT JOIN subtasks s ON s.id = i.subtask_id
    WHERE i.task_id = ? AND i.day = ? ORDER BY u.name, i.subtask_id`).all(task.id, dayKeyOf(task.id))
    .map((i) => ({ ...i, actions_done: parseArr(i.actions_done) })));
});

// per-day completion history of a daily task (admin view): who finished it each day in the range
r.get('/tasks/:id/daily', requireRole('admin', 'super'), (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'المهمة غير موجودة' });
  if (!inScope(req.user, task)) return res.status(403).json(FORBIDDEN);
  if (!isDaily(task)) return res.status(400).json({ error: 'هذه ليست مهمة يومية' });
  const rng = dateRange(req.query); // defaults to the last 30 days
  if (rng.error) return res.status(400).json({ error: rng.error });
  const subCount = db.prepare('SELECT COUNT(*) c FROM subtasks WHERE task_id = ?').get(task.id).c;
  const rows = subCount === 0
    ? db.prepare(`SELECT day, user_id FROM interactions
        WHERE task_id = ? AND done = 1 AND subtask_id IS NULL AND day != '' AND day BETWEEN ? AND ?`)
      .all(task.id, rng.from, rng.to)
    : db.prepare(`SELECT day, user_id FROM interactions
        WHERE task_id = ? AND done = 1 AND subtask_id IS NOT NULL AND day != '' AND day BETWEEN ? AND ?
        GROUP BY day, user_id HAVING COUNT(DISTINCT subtask_id) = ?`)
      .all(task.id, rng.from, rng.to, subCount);
  const ids = new Set(members(task.group_id));
  const nameOf = new Map(db.prepare('SELECT id, name FROM users WHERE group_id = ?').all(task.group_id).map((u) => [u.id, u.name]));
  const byDay = new Map();
  for (const x of rows) {
    if (!ids.has(x.user_id)) continue;
    if (!byDay.has(x.day)) byDay.set(x.day, []);
    byDay.get(x.day).push(nameOf.get(x.user_id) ?? '');
  }
  const days = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([d, names]) => ({ day: d, done: names.length, total: ids.size, names }));
  res.json({ from: rng.from, to: rng.to, total: ids.size, days });
});

r.put('/tasks/:id/interactions', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'المهمة غير موجودة' });
  if (!inScope(req.user, task)) return res.status(403).json({ error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' });
  const b = req.body || {};
  const subtaskId = b.subtask_id ?? null;
  let required = []; // the subtask's declared actions; empty for task-level rows
  if (subtaskId != null) {
    const s = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(subtaskId);
    if (!s || s.task_id !== task.id) return res.status(400).json({ error: 'المهمة الفرعية غير صالحة' });
    required = parseArr(s.actions);
  }
  let actionsDone = [];
  if (b.actions_done != null) {
    if (!Array.isArray(b.actions_done) || b.actions_done.some((k) => !ACTIONS.includes(k)))
      return res.status(400).json({ error: 'إجراء غير صالح' });
    actionsDone = [...new Set(b.actions_done)];
    if (actionsDone.some((k) => !required.includes(k)))
      return res.status(400).json({ error: 'إجراء غير مطلوب في هذه المهمة الفرعية' });
  }
  if (isDaily(task) && !repeatActive(task))
    return res.status(400).json({ error: 'المهمة اليومية غير نشطة حاليًا' });
  // subtask has actions -> done is derived (client done ignored); otherwise manual flag
  const done = required.length ? (required.every((k) => actionsDone.includes(k)) ? 1 : 0) : (b.done ? 1 : 0);
  const adJson = actionsDone.length ? JSON.stringify(actionsDone) : null;
  const dk = dayKey(task);
  const wasDone = taskDone(task.id, [req.user.id]);
  const existing = db.prepare(
    'SELECT id FROM interactions WHERE task_id = ? AND user_id = ? AND COALESCE(subtask_id, 0) = COALESCE(?, 0) AND day = ?')
    .get(task.id, req.user.id, subtaskId, dk);
  let id;
  if (existing) {
    db.prepare("UPDATE interactions SET done = ?, notes = ?, actions_done = ?, updated_at = datetime('now') WHERE id = ?")
      .run(done, b.notes ?? null, adJson, existing.id);
    id = existing.id;
  } else {
    id = db.prepare('INSERT INTO interactions (task_id, subtask_id, user_id, done, notes, actions_done, day) VALUES (?,?,?,?,?,?,?)')
      .run(task.id, subtaskId, req.user.id, done, b.notes ?? null, adJson, dk).lastInsertRowid;
  }
  if (!wasDone && taskDone(task.id, [req.user.id])) { // completion flipped -> tell the group's admins
    const name = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id).name;
    notify(groupAdmins(task.group_id, req.user.id), {
      key: `task:${task.id}:done:${req.user.id}` + (dk ? `:${dk}` : ''), kind: 'task_done', title: `إنجاز مهمة: ${task.title}`,
      body: `بواسطة ${name}` + (b.notes ? `: ${b.notes}` : ''), link: '/tasks',
    }, req.user.id);
  }
  const row = db.prepare('SELECT * FROM interactions WHERE id = ?').get(id);
  res.json({ ...row, actions_done: parseArr(row.actions_done) });
});

// team pulse: per-member completion over ACTIVE group tasks + people list (for @mentions)
r.get('/tasks/team', (req, res) => {
  const gid = scopeGid(req, res);
  if (gid === false) return;
  if (!gid) return res.json({ group: null, tasks: 0, members: [], admins: [] });
  const group = db.prepare('SELECT id, name FROM groups WHERE id = ?').get(gid) ?? null;
  const tasks = db.prepare('SELECT id FROM tasks WHERE group_id = ? AND archived = 0').all(gid);
  const people = db.prepare("SELECT id, name, role FROM users WHERE group_id = ? AND active = 1 ORDER BY name").all(gid);
  // ponytail: O(tasks×members) tiny queries — fine at group scale; cache per-task done-sets if it ever matters
  // members get names only (for @mentions / private messages): per-member stats are a group-admin permission
  const withStats = req.user.role !== 'user';
  const members = people.filter((u) => u.role === 'user')
    .map((u) => ({ id: u.id, name: u.name,
      total: withStats ? tasks.length : 0,
      done: withStats ? tasks.filter((t) => taskDone(t.id, [u.id])).length : 0 }));
  res.json({ group, tasks: tasks.length, members, admins: people.filter((u) => u.role === 'admin').map(({ id, name }) => ({ id, name })) });
});

const senderName = (id) => db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name ?? 'المشرف';

// nudge pending members → task_nudge notification. Key is per task+day, so each member gets at most one
// reminder per task per day (INSERT OR IGNORE); the response says how many were actually sent.
r.post('/tasks/:id/nudge', requireRole('admin', 'super'), (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'المهمة غير موجودة' });
  if (!inScope(req.user, task)) return res.status(403).json({ error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' });
  const b = req.body || {};
  const pending = members(task.group_id).filter((id) => !taskDone(task.id, [id]));
  const targets = Array.isArray(b.user_ids) ? pending.filter((id) => b.user_ids.includes(id)) : pending;
  if (!targets.length) return res.status(400).json({ error: 'لا أعضاء بانتظار التنبيه' });
  const key = `task:${task.id}:nudge:${day()}`;
  const count = () => db.prepare(`SELECT COUNT(*) c FROM notifications WHERE key = ? AND user_id IN (${targets.map(() => '?').join(',')})`).get(key, ...targets).c;
  const before = count();
  const due = task.due_date ? ` — الاستحقاق ${task.due_date.slice(0, 10)}` : '';
  const message = String(b.message ?? '').trim().slice(0, 500);
  notify(targets, { key, kind: 'task_nudge', title: `تذكير: ${task.title}`,
    body: message || `المهمة بانتظار إنجازك${due}. — ${senderName(req.user.id)}`, link: '/tasks' });
  const sent = count() - before;
  res.json({ notified: sent, skipped: targets.length - sent });
});

// private message about a task → a single-recipient `message` notification
// (ponytail: no thread table — replying = sending a message back from the same popup)
r.post('/tasks/:id/message', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'المهمة غير موجودة' });
  if (!inScope(req.user, task)) return res.status(403).json({ error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' });
  const b = req.body || {};
  const to = db.prepare('SELECT id, group_id, active FROM users WHERE id = ?').get(Number(b.user_id));
  if (!to || !to.active || to.group_id !== task.group_id || to.id === req.user.id)
    return res.status(400).json({ error: 'المستلم غير صالح' });
  const body = String(b.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'نص الرسالة مطلوب' });
  if (body.length > 1000) return res.status(400).json({ error: 'الرسالة أطول من 1000 حرف' });
  notify([to.id], { key: `task:${task.id}:msg:${req.user.id}:${Date.now()}`, kind: 'message',
    title: `رسالة خاصة من ${senderName(req.user.id)}: ${task.title}`, body, link: '/tasks' });
  res.json({ ok: true });
});

const COMMENT_MAX = 2000;
const commentRow = (id) => db.prepare(`
  SELECT c.*, u.name AS user_name, u.role AS user_role FROM task_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?`).get(id);

r.get('/tasks/:id/comments', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'المهمة غير موجودة' });
  if (!inScope(req.user, task)) return res.status(403).json({ error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' });
  res.json(db.prepare(`
    SELECT c.*, u.name AS user_name, u.role AS user_role FROM task_comments c LEFT JOIN users u ON u.id = c.user_id
    WHERE c.task_id = ? ORDER BY c.id`).all(task.id));
});

r.post('/tasks/:id/comments', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'المهمة غير موجودة' });
  if (!inScope(req.user, task)) return res.status(403).json({ error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' });
  const body = String(req.body?.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'نص التعليق مطلوب' });
  if (body.length > COMMENT_MAX) return res.status(400).json({ error: `التعليق أطول من ${COMMENT_MAX} حرف` });
  const id = db.prepare('INSERT INTO task_comments (task_id, user_id, body) VALUES (?,?,?)').run(task.id, req.user.id, body).lastInsertRowid;
  res.json(commentRow(id));
});

// own comment, or any comment in scope for admin/super
r.delete('/comments/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM task_comments WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'التعليق غير موجود' });
  const task = getTask(c.task_id);
  const own = c.user_id === req.user.id;
  if (!(own || (req.user.role !== 'user' && inScope(req.user, task))))
    return res.status(403).json({ error: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' });
  db.prepare('DELETE FROM task_comments WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

// ---- manager dashboard (GET /stats detail) ----
const ATTENTION_SQL = "(a.status != 'active' OR a.last_checked_at IS NULL OR a.last_checked_at < datetime('now', ?))"; // bind `-${STALE_DAYS} days`
const STALE_ARG = `-${STALE_DAYS} days`;
const HEALTH = [[80, 'ممتاز', 'success'], [60, 'جيد', 'primary'], [40, 'يحتاج متابعة', 'warning'], [0, 'حرج', 'danger']];
const DUE_SOON_DAYS = 3; // mirrors the Tasks board lane "قريبة الاستحقاق"
const RANGE_MAX_DAYS = 366;
const pct = (n, d) => (d ? Math.round((n * 100) / d) : 0);
const isoDay = (s) => { const t = Date.parse(`${s}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s; };
const addDays = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

// {from,to} from query (defaults: last 30 days) or {error}
function dateRange(q) {
  const to = q.to || day(), from = q.from || (isoDay(to) && addDays(to, -29)); // bad `to` -> from=false -> invalid below
  if (!isoDay(from) || !isoDay(to) || from > to) return { error: 'نطاق التاريخ غير صالح (YYYY-MM-DD، ومن ≤ إلى)' };
  if (daysBetween(from, to) + 1 > RANGE_MAX_DAYS) return { error: `نطاق التاريخ يتجاوز ${RANGE_MAX_DAYS} يومًا` };
  return { from, to };
}

function dashboardDetail(me, { from, to }, groupId) {
  const today = day();
  // no active group means "every group" for a super ONLY — a leader with no group sees nothing, not everything
  const groups = groupId
    ? db.prepare('SELECT id, name FROM groups WHERE id = ?').all(groupId)
    : me.role === 'super'
      ? db.prepare('SELECT id, name FROM groups ORDER BY name').all()
      : [];
  const gids = groups.map((g) => g.id);
  const gin = gids.length ? `u.group_id IN (${gids.map(() => '?').join(',')})` : '0';
  const inRange = (ts) => ts != null && ts.slice(0, 10) >= from && ts.slice(0, 10) <= to;

  // ponytail: one flat member×task pair list; every number below is a filter over it (tiny data)
  const people = [], tasks = [], pairs = [];
  for (const g of groups) {
    const mems = db.prepare("SELECT id, name FROM users WHERE group_id = ? AND role = 'user' AND active = 1 ORDER BY name").all(g.id);
    for (const m of mems) people.push({ ...m, group_id: g.id, group_name: g.name });
    const ids = mems.map((m) => m.id);
    for (const t of db.prepare('SELECT * FROM tasks WHERE group_id = ?').all(g.id)) {
      const due = t.due_date ? t.due_date.slice(0, 10) : null;
      tasks.push({ ...t, due, created: inRange(t.created_at) });
      const at = new Map(doneRows(t.id, ids).map((x) => [x.user_id, x.completed_at]));
      for (const uid of ids) {
        const completed_at = at.get(uid) ?? null;
        pairs.push({
          gid: g.id, uid, task: t, kind: t.kind, due, completed_at,
          done: completed_at != null, created: inRange(t.created_at), completed: inRange(completed_at),
          on_time: completed_at != null && due != null && completed_at.slice(0, 10) <= due,
          overdue: completed_at == null && !t.archived && due != null && due < today,
        });
      }
    }
  }
  // completion over tasks created in range; on-time over completions in range that have a due date; overdue = snapshot
  const rates = (ps) => {
    const created = ps.filter((p) => p.created), timed = ps.filter((p) => p.completed && p.due);
    const done = created.filter((p) => p.done).length;
    return {
      done, total: created.length, completion: pct(done, created.length),
      on_time_rate: pct(timed.filter((p) => p.on_time).length, timed.length),
      overdue: new Set(ps.filter((p) => p.overdue).map((p) => p.task.id)).size,
      overdue_pct: pct(ps.filter((p) => p.overdue).length, ps.filter((p) => !p.task.archived).length),
    };
  };
  const accQ = (where, args) => ({
    count: db.prepare(`SELECT COUNT(*) c FROM accounts a JOIN users u ON u.id = a.user_id WHERE ${where}`).get(...args).c,
    attention: db.prepare(`SELECT COUNT(*) c FROM accounts a JOIN users u ON u.id = a.user_id WHERE ${where} AND ${ATTENTION_SQL}`).get(...args, STALE_ARG).c,
  });
  const health = (r, acc) => Math.round(0.4 * r.completion + 0.3 * r.on_time_rate
    + 0.2 * Math.max(0, 100 - r.overdue_pct) + 0.1 * Math.max(0, 100 - pct(acc.attention, acc.count)));
  const healthLabel = (h) => HEALTH.find(([min]) => h >= min);

  const all = rates(pairs), acc = accQ(gin, gids);
  const overdueTasks = [...new Map(pairs.filter((p) => p.overdue).map((p) => [p.task.id, p.task])).values()]
    .map((t) => ({ ...t, days: daysBetween(t.due_date.slice(0, 10), today) })).sort((a, b) => b.days - a.days);
  const soon = addDays(today, DUE_SOON_DAYS);
  const dueSoon = new Set(pairs.filter((p) => !p.done && !p.task.archived && p.due && p.due >= today && p.due <= soon).map((p) => p.task.id));
  const byStatus = { active: 0, restricted: 0, suspended: 0, closed: 0 };
  for (const s of db.prepare(`SELECT a.status, COUNT(*) c FROM accounts a JOIN users u ON u.id = a.user_id WHERE ${gin} GROUP BY a.status`).all(...gids))
    byStatus[s.status] = s.c;
  const h = health(all, acc), [, health_label, health_tone] = healthLabel(h);

  const byDay = new Map();
  for (let d = from; d <= to; d = addDays(d, 1)) byDay.set(d, { date: d, created: 0, completed: 0 });
  for (const t of tasks) if (t.created) byDay.get(t.created_at.slice(0, 10)).created++;
  for (const p of pairs) if (p.completed) byDay.get(p.completed_at.slice(0, 10)).completed++;

  const attention = [
    ...overdueTasks.map((t) => ({ type: 'task', id: t.id, title: t.title, detail: `متأخرة منذ ${t.days} يوم`, severity: 'danger', link: '/tasks' })),
    ...db.prepare(`SELECT a.id, a.name, a.status, a.last_checked_at FROM accounts a JOIN users u ON u.id = a.user_id
      WHERE ${gin} AND ${ATTENTION_SQL} ORDER BY a.status != 'active' DESC, a.last_checked_at`).all(...gids, STALE_ARG)
      .map((a) => a.status !== 'active'
        ? { type: 'account', id: a.id, title: a.name, detail: `الحالة: ${STATUS_AR[a.status] ?? a.status}`, severity: 'danger', link: '/accounts' }
        : { type: 'account', id: a.id, title: a.name, severity: 'warning', link: '/accounts',
            detail: a.last_checked_at ? `آخر فحص منذ ${daysBetween(a.last_checked_at.slice(0, 10), today)} يوم` : 'لم يُفحص بعد' }),
  ].slice(0, 10);

  return {
    range: { from, to },
    kpis: {
      tasks_created: tasks.filter((t) => t.created).length,
      completions: pairs.filter((p) => p.completed).length,
      completion_rate: all.completion, on_time_rate: all.on_time_rate,
      overdue: all.overdue, due_soon: dueSoon.size,
      avg_overdue_days: overdueTasks.length ? Math.round((overdueTasks.reduce((n, t) => n + t.days, 0) * 10) / overdueTasks.length) / 10 : 0,
      // members who touched any task in the range (not the member headcount — that's `users`)
      active_members: db.prepare(`SELECT COUNT(DISTINCT i.user_id) c FROM interactions i JOIN users u ON u.id = i.user_id
        WHERE ${gin} AND u.role = 'user' AND u.active = 1 AND date(i.updated_at) BETWEEN ? AND ?`).get(...gids, from, to).c,
      accounts_by_status: byStatus,
      health: h, health_label, health_tone,
    },
    series: [...byDay.values()],
    tasks_by_kind: KINDS.map((kind) => ({
      kind, total: tasks.filter((t) => t.created && t.kind === kind).length,
      completion: rates(pairs.filter((p) => p.kind === kind)).completion,
    })),
    groups: groups.map((g) => {
      const r = rates(pairs.filter((p) => p.gid === g.id)), a = accQ('u.group_id = ?', [g.id]), hg = health(r, a);
      const [, label, tone] = healthLabel(hg);
      return { id: g.id, name: g.name, members: people.filter((m) => m.group_id === g.id).length, accounts: a.count,
        tasks: tasks.filter((t) => t.created && t.group_id === g.id).length, completion: r.completion, on_time_rate: r.on_time_rate,
        overdue: r.overdue, attention: a.attention, health: hg, health_label: label, health_tone: tone };
    }),
    members: people.map((m) => {
      const r = rates(pairs.filter((p) => p.uid === m.id));
      return { id: m.id, name: m.name, group_name: m.group_name, done: r.done, total: r.total, completion: r.completion,
        on_time_rate: r.on_time_rate, overdue: r.overdue, attention: accQ('a.user_id = ?', [m.id]).attention };
    }).sort((a, b) => b.completion - a.completion || a.name.localeCompare(b.name, 'ar')).slice(0, 20),
    attention,
    recent: db.prepare(`SELECT e.id, e.kind, e.summary, acc.name AS account_name, actor.name AS actor_name, e.created_at
      FROM account_events e JOIN accounts acc ON acc.id = e.account_id JOIN users u ON u.id = acc.user_id
      LEFT JOIN users actor ON actor.id = e.user_id WHERE ${gin} ORDER BY e.id DESC LIMIT 10`).all(...gids),
  };
}

r.get('/stats', (req, res) => {
  const me = req.user;
  const onlyUser = me.role === 'user' ? me.id : null;
  const gid = scopeGid(req, res);   // admin: active group · super: ?group_id or null (= all) · member: own group
  if (gid === false) return;
  // admin/super: validated range + detail block, scoped to the active group (super with none = every group)
  let detail = null;
  if (!onlyUser) {
    const rng = dateRange(req.query);
    if (rng.error) return res.status(400).json({ error: rng.error });
    detail = dashboardDetail(me, rng, gid);
  }
  // unread chat messages in the active room, not mine, past my read pointer
  const roomId = gid;
  const chat_unread = roomId ? db.prepare(`SELECT COUNT(*) c FROM chat_messages WHERE group_id = ? AND deleted = 0 AND user_id != ?
    AND id > COALESCE((SELECT last_read_id FROM chat_reads WHERE user_id = ? AND group_id = ?), 0)`).get(roomId, me.id, me.id, roomId).c : 0;
  // groupless admin has empty scope, not global
  if (me.role === 'admin' && !gid)
    return res.json({ users: 0, accounts: 0, pages: 0, tasks: 0, completion: 0, my_pending: 0, accounts_attention: 0, accounts_by_type: [], chat_unread, detail });

  const accWhere = onlyUser ? 'a.user_id = ?' : gid ? 'u.group_id = ?' : '1=1';
  const accArgs = onlyUser ? [onlyUser] : gid ? [gid] : [];
  const accounts = db.prepare(
    `SELECT COUNT(*) c FROM accounts a JOIN users u ON u.id = a.user_id WHERE ${accWhere}`).get(...accArgs).c;
  const pages = db.prepare(
    `SELECT COUNT(*) c FROM pages p JOIN accounts a ON a.id = p.account_id JOIN users u ON u.id = a.user_id WHERE ${accWhere}`)
    .get(...accArgs).c;
  const accounts_attention = db.prepare(
    `SELECT COUNT(*) c FROM accounts a JOIN users u ON u.id = a.user_id WHERE ${accWhere} AND ${ATTENTION_SQL}`)
    .get(...accArgs, STALE_ARG).c;
  const users = onlyUser ? 1
    : db.prepare(`SELECT COUNT(*) c FROM users WHERE role = 'user' AND active = 1 ${gid ? 'AND group_id = ?' : ''}`)
      .get(...(gid ? [gid] : [])).c;

  const tasks = me.role === 'super'
    ? db.prepare('SELECT id, group_id FROM tasks').all()
    : gid != null
      ? db.prepare('SELECT id, group_id FROM tasks WHERE group_id = ?').all(gid)
      : []; // groupless user: no group tasks
  let done = 0, total = 0;
  const memberCache = new Map();
  for (const t of tasks) {
    if (!memberCache.has(t.group_id)) memberCache.set(t.group_id, members(t.group_id));
    const ids = onlyUser ? [onlyUser] : memberCache.get(t.group_id);
    done += taskDone(t.id, ids);
    total += ids.length;
  }

  // active tasks in my group I haven't completed (all-subtasks rule); 0 when groupless
  let my_pending = 0;
  if (me.group_id)
    for (const t of db.prepare('SELECT id FROM tasks WHERE group_id = ? AND archived = 0').all(me.group_id))
      if (!taskDone(t.id, [me.id])) my_pending++;

  const accounts_by_type = db.prepare(
    `SELECT t.name, COUNT(*) AS count FROM accounts a JOIN users u ON u.id = a.user_id
     JOIN account_types t ON t.id = a.type_id WHERE ${accWhere} GROUP BY t.name ORDER BY count DESC`).all(...accArgs);

  res.json({
    users, accounts, pages,
    tasks: tasks.length,
    completion: total ? Math.round((done * 100) / total) : 0,
    my_pending,
    accounts_attention,
    accounts_by_type,
    chat_unread,
    ...(detail && { detail }),
  });
});

module.exports = r;
module.exports.members = members;
module.exports.taskDone = taskDone;
module.exports.STALE_DAYS = STALE_DAYS;
