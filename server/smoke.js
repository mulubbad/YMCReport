// node smoke.js — run against a FRESH DB (DB_PATH to a new file), server on :3001
const B = process.env.API || 'http://localhost:3001/api';
const results = [];

async function call(method, path, token, body) {
  const res = await fetch(B + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, ct };
}

function step(name, ok, detail) {
  results.push(`${name}: ${ok ? 'PASS' : 'FAIL'}${ok ? '' : ' ' + (detail || '')}`);
  if (!ok) { console.log(results.join('\n')); process.exit(1); }
}

(async () => {
  const sl = await call('POST', '/login', null, { username: 'super', password: 'super123' });
  step('login super', sl.status === 200 && !!sl.data.token, JSON.stringify(sl.data));
  const sup = sl.data.token;

  const g = await call('POST', '/groups', sup, { name: 'Alpha' });
  step('create group', g.status === 200 && !!g.data.id, JSON.stringify(g.data));

  const ad = await call('POST', '/users', sup, { username: 'admin1', password: 'pass1234', name: 'Admin One', role: 'admin', group_id: g.data.id });
  const us = await call('POST', '/users', sup, { username: 'user1', password: 'pass1234', name: 'User One', role: 'user', group_id: g.data.id });
  step('create admin+user', ad.status === 200 && us.status === 200, JSON.stringify([ad.data, us.data]));

  const al = await call('POST', '/login', null, { username: 'admin1', password: 'pass1234' });
  const ul = await call('POST', '/login', null, { username: 'user1', password: 'pass1234' });
  step('login admin+user', al.status === 200 && ul.status === 200);
  const at = al.data.token, ut = ul.data.token;

  const ty = await call('POST', '/types', at, { name: 'facebook', allows_pages: true });
  const si = await call('POST', '/sites', at, { name: 'Main Site', url: 'https://example.com' });
  const tys = await call('GET', '/types', ut);
  step('types/sites', ty.status === 200 && si.status === 200 && tys.status === 200 && tys.data.length === 1,
    JSON.stringify([ty.data, si.data, tys.data]));

  const acc = await call('POST', '/accounts', ut, { type_id: ty.data.id, site_id: si.data.id, name: 'FB Main', mobile: '0590000000', password: 'secret' });
  step('create account', acc.status === 200 && acc.data.type_name === 'facebook' && acc.data.owner_name === 'User One',
    JSON.stringify(acc.data));

  const pg = await call('POST', `/accounts/${acc.data.id}/pages`, ut, { name: 'My Page', url: 'https://fb.com/p' });
  step('create page', pg.status === 200 && !!pg.data.id, JSON.stringify(pg.data));

  const tk = await call('POST', '/tasks', at, {
    kind: 'interact', title: 'Engage post', description: 'like and share',
    subtasks: [{ title: 'like', url: 'https://x/1' }, { title: 'share' }],
  });
  step('create task+subtasks', tk.status === 200 && tk.data.subtasks.length === 2, JSON.stringify(tk.data));
  const [s1, s2] = tk.data.subtasks;

  const i1 = await call('PUT', `/tasks/${tk.data.id}/interactions`, ut, { subtask_id: s1.id, done: true, notes: 'liked' });
  const i2 = await call('PUT', `/tasks/${tk.data.id}/interactions`, ut, { subtask_id: s2.id, done: true });
  const i3 = await call('PUT', `/tasks/${tk.data.id}/interactions`, ut, { subtask_id: s1.id, done: true, notes: 'liked again' });
  step('interactions upsert', i1.status === 200 && i2.status === 200 && i3.status === 200 && i3.data.notes === 'liked again' && i3.data.id === i1.data.id,
    JSON.stringify([i1.data, i3.data]));

  const tl = await call('GET', '/tasks', ut);
  const t0 = tl.status === 200 && tl.data[0];
  step('task list progress+mine', !!t0 && t0.progress.done === 1 && t0.progress.total === 1 && t0.subtasks[0].mine.done === 1,
    JSON.stringify(tl.data));

  const ints = await call('GET', `/tasks/${tk.data.id}/interactions`, at);
  step('admin reads interactions', ints.status === 200 && ints.data.length === 2 && ints.data.every((x) => x.user_name && x.subtask_title),
    JSON.stringify(ints.data));

  const st = await call('GET', '/stats', at);
  step('stats', st.status === 200 && st.data.users === 1 && st.data.accounts === 1 && st.data.pages === 1
    && st.data.tasks === 1 && st.data.completion === 100 && st.data.accounts_by_type[0].name === 'facebook',
    JSON.stringify(st.data));

  const cm = await call('POST', `/tasks/${tk.data.id}/comments`, ut, { body: 'تم، @Admin One راجع الرابط' });
  const cl = await call('GET', `/tasks/${tk.data.id}/comments`, at);
  const tm = await call('GET', '/tasks/team', ut);
  const cd = await call('DELETE', `/comments/${cm.data.id}`, at);
  const bad = await call('POST', `/tasks/${tk.data.id}/comments`, ut, { body: '   ' });
  step('comments+team', cm.status === 200 && cm.data.user_name === 'User One' && cl.status === 200 && cl.data.length === 1
    && tm.status === 200 && tm.data.group.name === 'Alpha' && tm.data.members[0].done === 1 && tm.data.admins.length === 1
    && cd.status === 200 && bad.status === 400,
    JSON.stringify([cm.data, tm.data, bad.data]));

  const us2 = await call('POST', '/users', sup, { username: 'user2', password: 'pass1234', name: 'User Two', role: 'user', group_id: g.data.id });
  const nd = await call('POST', `/tasks/${tk.data.id}/nudge`, at, {});
  const nd2 = await call('POST', `/tasks/${tk.data.id}/nudge`, at, {});
  const u2l = await call('POST', '/login', null, { username: 'user2', password: 'pass1234' });
  const msg = await call('POST', `/tasks/${tk.data.id}/message`, at, { user_id: us2.data.id, body: 'مرحبًا' });
  const self = await call('POST', `/tasks/${tk.data.id}/message`, at, { user_id: ad.data.id, body: 'x' });
  const nf = await call('GET', '/notifications', u2l.data.token);
  const kinds = nf.data.items.map((n) => n.kind);
  step('nudge+message', nd.status === 200 && nd.data.notified === 1 && nd2.status === 200 && nd2.data.notified === 0 && nd2.data.skipped === 1
    && msg.status === 200 && self.status === 400 && kinds.includes('task_nudge') && kinds.includes('message'),
    JSON.stringify([nd.data, nd2.data, self.data, kinds]));

  const ex = await call('GET', '/export', at);
  step('export xlsx', ex.status === 200 && ex.ct.includes('spreadsheetml') && ex.data.subarray(0, 2).toString() === 'PK',
    `ct=${ex.ct} bytes=${ex.data.length}`);

  console.log(results.join('\n'));
})().catch((e) => { console.log(results.join('\n')); console.error('FAIL (exception)', e.message); process.exit(1); });
