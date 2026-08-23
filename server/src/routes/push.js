const express = require('express');
const db = require('../db');
const { auth } = require('../auth');

const r = express.Router();
r.use(auth);

const valid = (t) => typeof t === 'string' && t.length >= 20 && t.length <= 4096;

// register this device for the caller; a token already bound to another user (shared device) is re-bound
r.post('/push/token', (req, res) => {
  const { token } = req.body || {};
  if (!valid(token)) return res.status(400).json({ error: 'رمز الجهاز غير صالح' });
  db.prepare('INSERT INTO push_tokens (token, user_id) VALUES (?, ?) ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id').run(token, req.user.id);
  res.json({ ok: true });
});

// logout / disable: only the caller's own row is removed
r.delete('/push/token', (req, res) => {
  const token = String(req.query.token || '');
  if (valid(token)) db.prepare('DELETE FROM push_tokens WHERE token = ? AND user_id = ?').run(token, req.user.id);
  res.json({ ok: true });
});

module.exports = r;
