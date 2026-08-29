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
  const tla = await call('GET', '/tasks', at);
  step('task list progress+mine', !!t0 && t0.progress.total === 0 && t0.done_ids.length === 0 && t0.subtasks[0].mine.done === 1
    && tla.data[0].progress.done === 1 && tla.data[0].progress.total === 1 && tla.data[0].done_ids.length === 1,
    JSON.stringify([tl.data, tla.data[0].progress]));

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
  const tma = await call('GET', '/tasks/team', at);
  const cd = await call('DELETE', `/comments/${cm.data.id}`, at);
  const bad = await call('POST', `/tasks/${tk.data.id}/comments`, ut, { body: '   ' });
  step('comments+team', cm.status === 200 && cm.data.user_name === 'User One' && cl.status === 200 && cl.data.length === 1
    && tm.status === 200 && tm.data.group.name === 'Alpha' && tm.data.members[0].done === 0 && tm.data.members[0].total === 0
    && tma.data.members[0].done === 1 && tm.data.admins.length === 1
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

  // ---- sims: role-based owner assignment + group-scoped listing ----
  const sm1 = await call('POST', '/sims', ut, { number: '0591111111' });
  const smf = await call('POST', '/sims', ut, { number: '0562222222', user_id: us2.data.id });
  step('sims user self-only', sm1.status === 200 && sm1.data.owner_name === 'User One' && smf.status === 403,
    JSON.stringify([sm1.data, smf.data]));

  const sm2 = await call('POST', '/sims', at, { number: '0562222222', user_id: us2.data.id });
  const gB = await call('POST', '/groups', sup, { name: 'Beta' });
  const ub = await call('POST', '/users', sup, { username: 'userb', password: 'pass1234', name: 'User Beta', role: 'user', group_id: gB.data.id });
  const smx = await call('POST', '/sims', at, { number: '0593333333', user_id: ub.data.id });
  const sms = await call('POST', '/sims', sup, { number: '0594444444', user_id: ub.data.id });
  step('sims owner assignment', sm2.status === 200 && sm2.data.owner_name === 'User Two' && smx.status === 403
    && sms.status === 200 && sms.data.owner_name === 'User Beta',
    JSON.stringify([sm2.data, smx.data, sms.data]));

  const la = await call('GET', '/sims', at);
  const lf = await call('GET', `/sims?user_id=${us2.data.id}`, at);
  const lu = await call('GET', '/sims', ut);
  step('sims group listing+filter', la.status === 200 && la.data.length === 2
    && lf.status === 200 && lf.data.length === 1 && lf.data[0].owner_name === 'User Two'
    && lu.status === 200 && lu.data.length === 1,
    JSON.stringify([la.data.length, lf.data.length, lu.data.length]));

  const rea = await call('PUT', `/sims/${sm1.data.id}`, at, { user_id: us2.data.id });
  const reb = await call('PUT', `/sims/${sm2.data.id}`, at, { user_id: ub.data.id });
  step('sims owner reassign', rea.status === 200 && rea.data.user_id === us2.data.id && reb.status === 403,
    JSON.stringify([rea.data, reb.data]));

  // ---- accounts: same owner scenario ----
  const ac2 = await call('POST', '/accounts', at, { type_id: ty.data.id, name: 'FB Two', mobile: '0591111111', user_id: us2.data.id });
  const acf = await call('POST', '/accounts', ut, { type_id: ty.data.id, name: 'FB Bad', mobile: '0592222222', user_id: us2.data.id });
  const acx = await call('POST', '/accounts', at, { type_id: ty.data.id, name: 'FB Cross', mobile: '0593333333', user_id: ub.data.id });
  step('accounts owner assignment', ac2.status === 200 && ac2.data.owner_name === 'User Two' && acf.status === 403 && acx.status === 403,
    JSON.stringify([ac2.data.owner_name, acf.data, acx.data]));

  const alist = await call('GET', '/accounts', at);
  const aflt = await call('GET', `/accounts?user_id=${us2.data.id}`, at);
  step('accounts group listing+filter', alist.status === 200 && alist.data.length === 2
    && aflt.status === 200 && aflt.data.length === 1 && aflt.data[0].owner_name === 'User Two',
    JSON.stringify([alist.data.length, aflt.data.length]));

  const are = await call('PUT', `/accounts/${acc.data.id}`, at, { user_id: us2.data.id });
  const arx = await call('PUT', `/accounts/${acc.data.id}`, at, { user_id: ub.data.id });
  const ars = await call('PUT', `/accounts/${acc.data.id}`, sup, { user_id: ub.data.id }); // type stays in Alpha -> 400
  step('accounts owner reassign', are.status === 200 && are.data.user_id === us2.data.id && are.data.owner_name === 'User Two'
    && arx.status === 403 && ars.status === 400,
    JSON.stringify([are.data.owner_name, arx.data, ars.data]));

  const mon = await call('GET', '/users', at);
  step('users last_seen', mon.status === 200 && mon.data.every((u) => u.last_seen_at),
    JSON.stringify(mon.data.map((u) => [u.username, u.last_seen_at])));

  // ---- profile: self password change + change requests approve/decline ----
  const pwBad = await call('PUT', `/users/${us.data.id}`, ut, { password: 'newpass99', current_password: 'wrong' });
  const pwOk = await call('PUT', `/users/${us.data.id}`, ut, { password: 'newpass99', current_password: 'pass1234' });
  const relog = await call('POST', '/login', null, { username: 'user1', password: 'newpass99' });
  step('profile password change', pwBad.status === 400 && pwOk.status === 200 && relog.status === 200,
    JSON.stringify([pwBad.data, pwOk.status, relog.status]));

  const selfName = await call('PUT', `/users/${us.data.id}`, ut, { name: 'Hacked Direct' });
  const meAfter = await call('GET', '/me', ut);
  step('profile direct name blocked', selfName.status === 200 && meAfter.data.name === 'User One',
    JSON.stringify(meAfter.data));

  const rq1 = await call('POST', '/profile/requests', ut, { name: 'User One Prime' });
  const rqDup = await call('POST', '/profile/requests', ut, { name: 'Another' });
  step('profile request create', rq1.status === 200 && rq1.data.status === 'pending'
    && rq1.data.changes.name.to === 'User One Prime' && rqDup.status === 400,
    JSON.stringify([rq1.data, rqDup.data]));

  const rqApprove = await call('PUT', `/profile/requests/${rq1.data.id}`, sup, { status: 'approved' });
  const meApproved = await call('GET', '/me', ut);
  const rq2 = await call('POST', '/profile/requests', ut, { username: 'user1x' });
  const rqDecline = await call('PUT', `/profile/requests/${rq2.data.id}`, sup, { status: 'declined', note: 'غير مناسب' });
  const hist = await call('GET', '/profile/requests', ut);
  const settled = await call('PUT', `/profile/requests/${rq2.data.id}`, at, { status: 'approved' }); // already decided
  step('profile request review+history', rqApprove.status === 200 && meApproved.data.name === 'User One Prime'
    && rqDecline.status === 200 && rqDecline.data.status === 'declined' && rqDecline.data.note === 'غير مناسب'
    && hist.status === 200 && hist.data.length === 2 && settled.status === 400,
    JSON.stringify([meApproved.data.name, rqDecline.data, hist.data.length, settled.data]));

  // the group's own leader decides its members' requests — no super needed
  const rq3 = await call('POST', '/profile/requests', ut, { username: 'user1z' });
  const adminQueue = await call('GET', '/profile/requests', at);
  const adminOk = await call('PUT', `/profile/requests/${rq3.data.id}`, at, { status: 'approved' });
  const meRenamed = await call('GET', '/me', ut);
  step('group leader reviews own member request', rq3.status === 200
    && adminQueue.status === 200 && adminQueue.data.some((x) => x.id === rq3.data.id)
    && adminOk.status === 200 && adminOk.data.status === 'approved' && meRenamed.data.username === 'user1z',
    JSON.stringify([adminQueue.data.length, adminOk.data, meRenamed.data.username]));

  // a leader may rename a member directly (username included); members still cannot rename themselves
  const setUname = await call('PUT', `/users/${us.data.id}`, at, { name: 'User One Renamed', username: 'user1final' });
  const takenUname = await call('PUT', `/users/${us.data.id}`, at, { username: 'user2' });
  const selfUname = await call('PUT', `/users/${us.data.id}`, ut, { username: 'sneaky' });
  const meRe = await call('GET', '/me', ut);
  step('leader edits member username', setUname.status === 200 && setUname.data.username === 'user1final'
    && takenUname.status === 400 && selfUname.status === 200 && meRe.data.username === 'user1final',
    JSON.stringify([setUname.data, takenUname.data, meRe.data.username]));

  const dt = await call('POST', '/tasks', at, { kind: 'general', title: 'Daily standup', repeat: 'daily' });
  const di = await call('PUT', `/tasks/${dt.data.id}/interactions`, ut, { done: true });
  const dl = await call('GET', '/tasks', ut);
  const drow = dl.data.find((x) => x.id === dt.data.id);
  const dla = await call('GET', '/tasks', at);
  const drowA = dla.data.find((x) => x.id === dt.data.id);
  const yesterday = new Date(Date.now() - 864e5).toLocaleDateString('en-CA');
  const xt = await call('POST', '/tasks', at, { kind: 'general', title: 'Expired daily', repeat: 'daily', repeat_until: yesterday });
  const xi = await call('PUT', `/tasks/${xt.data.id}/interactions`, ut, { done: true });
  const badRep = await call('POST', '/tasks', at, { kind: 'general', title: 'Bad', repeat: 'daily', repeat_from: '2026-09-02', repeat_until: '2026-09-01' });
  step('daily task', dt.status === 200 && dt.data.repeat === 'daily' && dt.data.repeat_active === 1 && dt.data.due_date == null
    && di.status === 200 && drow && drow.mine.done === 1 && drow.my_streak === 1 && drow.progress.total === 0 && drowA.progress.done === 1
    && xt.data.repeat_active === 0 && xi.status === 400 && badRep.status === 400,
    JSON.stringify([dt.data.repeat, dt.data.repeat_active, drow && [drow.mine.done, drow.my_streak], xi.data, badRep.data]));

  const dh = await call('GET', `/tasks/${dt.data.id}/daily`, at);
  const dhDeny = await call('GET', `/tasks/${dt.data.id}/daily`, ut);
  const dhNot = await call('GET', `/tasks/${tk.data.id}/daily`, at);
  step('daily history', dh.status === 200 && dh.data.days.length === 1 && dh.data.days[0].done === 1
    && dh.data.days[0].names.length === 1 && dh.data.days[0].total >= 1
    && dhDeny.status === 403 && dhNot.status === 400,
    JSON.stringify([dh.data, dhDeny.status, dhNot.data]));

  // ---- activity: role gate + scoping + shape ----
  const acSum = await call('GET', '/activity/summary', at);
  const acDay = await call('GET', `/activity/${us.data.id}?from=2026-01-01&to=2026-12-31`, at);
  const acDeny = await call('GET', '/activity/summary', ut);
  const acCross = await call('GET', `/activity/${ub.data.id}`, at);
  step('activity endpoints', acSum.status === 200 && acSum.data.users.length === 3
    && acSum.data.users.every((u) => 'total_seconds' in u && 'active_days' in u)
    && acDay.status === 200 && Array.isArray(acDay.data.days)
    && acDeny.status === 403 && acCross.status === 403,
    JSON.stringify([acSum.data, acDay.data, acDeny.status, acCross.status]));

  // super is copied on every update notification (task created/completed, profile request)
  const supNf = await call('GET', '/notifications', sup);
  const supKinds = supNf.data.items.map((n) => n.kind);
  step('super update notifications', supNf.status === 200
    && ['task_new', 'task_done', 'profile_request'].every((k) => supKinds.includes(k)),
    JSON.stringify(supKinds));

  // ---- an admin leading SEVERAL groups: each group is an encapsulated workspace ----
  const adB = await call('POST', '/users', sup, { username: 'adminb', password: 'pass1234', name: 'Admin Beta', role: 'admin', group_id: gB.data.id });
  const adBt = (await call('POST', '/login', null, { username: 'adminb', password: 'pass1234' })).data.token;
  const solo = await call('GET', '/groups', adBt);
  const crossReq = await call('POST', '/profile/requests', ut, { name: 'Cross Attempt' });
  const crossDeny = await call('PUT', `/profile/requests/${crossReq.data.id}`, adBt, { status: 'approved' });
  step('leader sees only led groups', solo.status === 200 && solo.data.length === 1 && solo.data[0].name === 'Beta'
    && crossDeny.status === 403,
    JSON.stringify([solo.data.map((x) => x.name), crossDeny.data]));

  // super grants admin1 a second group
  const grant = await call('PUT', `/users/${ad.data.id}`, sup, { group_ids: [g.data.id, gB.data.id] });
  const myGroups = await call('GET', '/groups', at);
  step('super grants a second group', grant.status === 200
    && Array.isArray(grant.data.group_ids) && grant.data.group_ids.length === 2
    && myGroups.status === 200 && myGroups.data.length === 2
    && myGroups.data.every((x) => 'member_count' in x && 'account_count' in x && 'task_count' in x),
    JSON.stringify([grant.data.group_ids, myGroups.data.map((x) => x.name)]));

  // the SAME token now scopes to either group with ?group_id, and to Alpha (its default) without one
  const uAlpha = await call('GET', '/users', at);
  const uBeta = await call('GET', `/users?group_id=${gB.data.id}`, at);
  const uUnled = await call('GET', '/users?group_id=999', at);
  step('scope switches per group', uAlpha.status === 200 && uAlpha.data.every((u) => u.group_id === g.data.id)
    && uBeta.status === 200 && uBeta.data.length > 0 && uBeta.data.every((u) => u.group_id === gB.data.id)
    && uUnled.status === 403,
    JSON.stringify([uAlpha.data.map((u) => u.username), uBeta.data.map((u) => u.username), uUnled.status]));

  // full feature set inside the second group: members, data, tasks, reports, export
  const newB = await call('POST', `/users?group_id=${gB.data.id}`, at, { username: 'userb2', password: 'pass1234', name: 'User Beta Two' });
  const tyB = await call('POST', `/types?group_id=${gB.data.id}`, at, { name: 'x', allows_pages: false });
  const tkB = await call('POST', '/tasks', at, { kind: 'general', title: 'Beta task', group_id: gB.data.id });
  const simB = await call('POST', '/sims', at, { number: '0595555555', user_id: ub.data.id });
  const accB = await call('POST', '/accounts', at, { type_id: tyB.data.id, name: 'Beta acc', mobile: '0595555555', user_id: ub.data.id });
  const stB = await call('GET', `/stats?group_id=${gB.data.id}`, at);
  const repB = await call('GET', `/report?sheet=sims&group_id=${gB.data.id}`, at);
  const exB = await call('GET', `/export?group_id=${gB.data.id}`, at);
  step('second group is fully manageable', newB.status === 200 && newB.data.group_id === gB.data.id
    && tyB.status === 200 && tkB.status === 200 && tkB.data.group_id === gB.data.id
    && simB.status === 200 && accB.status === 200
    && stB.status === 200 && stB.data.detail && stB.data.detail.groups.length === 1 && stB.data.detail.groups[0].name === 'Beta'
    && repB.status === 200 && repB.data.rows.some((row) => row[1] === '0595555555')
    && exB.status === 200 && exB.data.subarray(0, 2).toString() === 'PK',
    JSON.stringify([newB.data, tkB.data.group_id, stB.data.detail && stB.data.detail.groups, repB.data.total]));

  // Alpha's numbers are untouched by Beta's data — the two workspaces stay separate
  const stA = await call('GET', '/stats', at);
  const tlA = await call('GET', '/tasks', at);
  const tlB = await call('GET', `/tasks?group_id=${gB.data.id}`, at);
  step('groups stay encapsulated', stA.status === 200 && stA.data.detail.groups.length === 1 && stA.data.detail.groups[0].name === 'Alpha'
    && tlA.data.every((t) => t.group_id === g.data.id) && tlB.data.every((t) => t.group_id === gB.data.id)
    && tlB.data.some((t) => t.title === 'Beta task') && !tlA.data.some((t) => t.title === 'Beta task'),
    JSON.stringify([stA.data.detail.groups.map((x) => x.name), tlA.data.length, tlB.data.length]));

  // revoking Beta closes every door again
  const revoke = await call('PUT', `/users/${ad.data.id}`, sup, { group_ids: [g.data.id] });
  const gone = await call('GET', `/users?group_id=${gB.data.id}`, at);
  const goneTask = await call('POST', '/tasks', at, { kind: 'general', title: 'nope', group_id: gB.data.id });
  step('revoking a group revokes access', revoke.status === 200 && revoke.data.group_ids.length === 1
    && gone.status === 403 && goneTask.status === 403,
    JSON.stringify([revoke.data.group_ids, gone.status, goneTask.status]));

  // ---- leak regressions: a leader must never reach a group they do not lead ----
  // 1. an admin who leads NO group gets an empty manager dashboard, not the whole system
  const orphan = await call('POST', '/users', sup, { username: 'orphan', password: 'pass1234', name: 'Orphan Admin', role: 'admin' });
  const ot = (await call('POST', '/login', null, { username: 'orphan', password: 'pass1234' })).data.token;
  const oStats = await call('GET', '/stats', ot);
  step('group-less admin sees no group', orphan.status === 200 && oStats.status === 200
    && oStats.data.detail && oStats.data.detail.groups.length === 0 && oStats.data.detail.members.length === 0
    && oStats.data.detail.recent.length === 0 && oStats.data.detail.attention.length === 0,
    JSON.stringify(oStats.data.detail));

  // 2+3. a leader moved out of a group loses its chat room and its tasks, even on a token minted before the move
  const adC = await call('POST', '/users', sup, { username: 'adminc', password: 'pass1234', name: 'Admin C', role: 'admin', group_id: g.data.id });
  const ct = (await call('POST', '/login', null, { username: 'adminc', password: 'pass1234' })).data.token;
  const secret = await call('POST', '/chat/messages', ct, { body: 'SECRET-ALPHA-ONLY' });
  const alphaTask = await call('POST', '/tasks', ct, { kind: 'general', title: 'Alpha only task' });
  await call('PUT', `/users/${adC.data.id}`, sup, { group_id: gB.data.id, group_ids: [gB.data.id] }); // moved to Beta
  const staleRoom = await call('GET', '/chat/messages', ct);          // no ?group_id -> must NOT fall back to Alpha
  const staleWrite = await call('POST', '/chat/messages', ct, { body: 'I-SHOULD-NOT-BE-HERE' });
  const staleTick = await call('PUT', `/tasks/${alphaTask.data.id}/interactions`, ct, { done: true });
  const staleTasks = await call('GET', '/tasks', ct);
  const alphaRoom = await call('GET', `/chat/messages?group_id=${g.data.id}`, sup);   // where did the write land?
  const betaRoom = await call('GET', `/chat/messages?group_id=${gB.data.id}`, sup);
  const bodies = (r) => r.data.items.map((m) => m.body);
  step('stale token cannot reach the old group', secret.status === 200 && alphaTask.status === 200
    && staleRoom.status === 200 && !bodies(staleRoom).includes('SECRET-ALPHA-ONLY')
    && staleWrite.status === 200
    && !bodies(alphaRoom).includes('I-SHOULD-NOT-BE-HERE') && bodies(betaRoom).includes('I-SHOULD-NOT-BE-HERE')
    && staleTick.status === 403
    && !staleTasks.data.some((t) => t.id === alphaTask.data.id),
    JSON.stringify([bodies(staleRoom), bodies(alphaRoom), bodies(betaRoom), staleTick.status]));

  // 4. the chat read pointer is per room — reading one room must not clear another's unread
  await call('PUT', `/users/${ad.data.id}`, sup, { group_ids: [g.data.id, gB.data.id] }); // admin1 leads both again
  const mA = await call('POST', `/chat/messages?group_id=${g.data.id}`, ut, { body: 'alpha-unread' });
  const mB = await call('POST', `/chat/messages?group_id=${gB.data.id}`, sup, { body: 'beta-unread' });
  const beforeA = await call('GET', `/stats?group_id=${g.data.id}`, at);
  const beforeB = await call('GET', `/stats?group_id=${gB.data.id}`, at);
  await call('PUT', `/chat/read?group_id=${g.data.id}`, at, { last_id: Math.max(mA.data.id, mB.data.id) });
  const afterA = await call('GET', `/stats?group_id=${g.data.id}`, at);
  const afterB = await call('GET', `/stats?group_id=${gB.data.id}`, at);
  step('chat read pointer is per room', beforeA.data.chat_unread > 0 && beforeB.data.chat_unread > 0
    && afterA.data.chat_unread === 0 && afterB.data.chat_unread === beforeB.data.chat_unread,
    JSON.stringify([beforeA.data.chat_unread, beforeB.data.chat_unread, afterA.data.chat_unread, afterB.data.chat_unread]));

  const ex = await call('GET', '/export', at);
  step('export xlsx', ex.status === 200 && ex.ct.includes('spreadsheetml') && ex.data.subarray(0, 2).toString() === 'PK',
    `ct=${ex.ct} bytes=${ex.data.length}`);

  console.log(results.join('\n'));
})().catch((e) => { console.log(results.join('\n')); console.error('FAIL (exception)', e.message); process.exit(1); });
