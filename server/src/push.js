const fs = require('fs');
const { GoogleAuth } = require('google-auth-library');
const db = require('./db');

// FIREBASE_SERVICE_ACCOUNT = path to the service-account JSON (Firebase console → Project settings → Service accounts) or the JSON itself.
// ponytail: raw FCM v1 REST via google-auth-library instead of firebase-admin (~100MB of deps for one POST)
let auth = null, project = null;
const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (sa) {
  try {
    const credentials = JSON.parse(sa.trim().startsWith('{') ? sa : fs.readFileSync(sa, 'utf8'));
    project = credentials.project_id;
    auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/firebase.messaging'] });
  } catch (e) { console.warn('push disabled — bad FIREBASE_SERVICE_ACCOUNT:', e.message); }
} else console.warn('push disabled — FIREBASE_SERVICE_ACCOUNT not set');

const del = db.prepare('DELETE FROM push_tokens WHERE token = ?');
const unreadOf = (uid) => db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(uid).c;

// delete a token only when FCM says the TOKEN is dead — a 400 can also mean a malformed
// message (which would otherwise wipe every recipient's valid token on one bad payload)
const tokenDead = (status, text) =>
  status === 404 || (status === 400 && /UNREGISTERED|registration token/i.test(text));

// one data-only message per device token (payload values must be strings, total ≤4KB → truncate);
// `unread` lets the SW sync the app-icon badge while the app is closed
async function push(userIds, { key, kind, title, body, link }) {
  if (!auth || !userIds.length) return;
  const { token: bearer } = await (await auth.getClient()).getAccessToken();
  await Promise.all(userIds.flatMap((uid) => {
    const tokens = db.prepare('SELECT token FROM push_tokens WHERE user_id = ?').all(uid).map((r) => r.token);
    if (!tokens.length) return [];
    const data = {
      key, kind,
      title: String(title).slice(0, 200),
      body: String(body || '').slice(0, 300),
      link: link || '/',
      unread: String(unreadOf(uid)),
    };
    return tokens.map(async (token) => {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token, data, webpush: { headers: { Urgency: 'high', TTL: '86400' } } } }),
      });
      if (res.ok) return;
      const text = (await res.text()).slice(0, 300);
      if (tokenDead(res.status, text)) del.run(token);
      else console.warn('fcm', res.status, text.slice(0, 200));
    });
  }));
}

module.exports = { push, enabled: () => !!auth };
