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

// one data-only message per device token; dead tokens (UNREGISTERED / invalid) are dropped
async function push(userIds, { key, kind, title, body, link }) {
  if (!auth || !userIds.length) return;
  const tokens = db.prepare(`SELECT token FROM push_tokens WHERE user_id IN (${userIds.map(() => '?').join(',')})`).all(...userIds).map((r) => r.token);
  if (!tokens.length) return;
  const { token: bearer } = await (await auth.getClient()).getAccessToken();
  await Promise.all(tokens.map(async (token) => {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: {
        token,
        data: { key, kind, title, body: body || '', link: link || '/' },
        webpush: { headers: { Urgency: 'high', TTL: '86400' } },
      } }),
    });
    if (res.status === 404 || res.status === 400) del.run(token);
    else if (!res.ok) console.warn('fcm', res.status, (await res.text()).slice(0, 200));
  }));
}

module.exports = { push };
