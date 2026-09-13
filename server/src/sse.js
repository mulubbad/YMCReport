// open SSE connections: res -> { uid, gid }; room = group_id
const conns = new Map();

const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

const add = (res, uid, gid) => conns.set(res, { uid, gid });
const remove = (res) => conns.delete(res);
const broadcastToGroup = (gid, event, data) => { for (const [res, c] of conns) if (c.gid === gid) send(res, event, data); };
// a direct message reaches exactly its two participants, and only on their connection to THIS room —
// a peer watching another group's room gets a push instead, never a cross-room frame
const sendToUsers = (gid, uids, event, data) => {
  const set = new Set(uids);
  for (const [res, c] of conns) if (c.gid === gid && set.has(c.uid)) send(res, event, data);
};
const onlineIds = (gid) => [...new Set([...conns.values()].filter((c) => c.gid === gid).map((c) => c.uid))];
const isOnline = (uid) => [...conns.values()].some((c) => c.uid === uid);

// ponytail: one heartbeat timer for all connections (keeps proxies from closing idle streams)
setInterval(() => { for (const res of conns.keys()) res.write(': ping\n\n'); }, 25_000).unref();

module.exports = { add, remove, send, broadcastToGroup, sendToUsers, onlineIds, isOnline };
