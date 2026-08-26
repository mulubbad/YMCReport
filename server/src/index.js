const path = require('path');
const fs = require('fs');
// ponytail: tiny .env loader for local dev (production uses /etc/ymcreport.env via systemd); never overrides real env
try {
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}
const express = require('express');
const cors = require('cors');
require('./db');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', require('./routes/chat')); // first: its SSE route authenticates from ?token
app.use('/api', require('./routes/core'));
app.use('/api', require('./routes/meta'));
app.use('/api', require('./routes/accounts'));
app.use('/api', require('./routes/sims'));
app.use('/api', require('./routes/notes'));
app.use('/api', require('./routes/tasks'));
app.use('/api', require('./routes/export'));
app.use('/api', require('./routes/profile'));
app.use('/api', require('./routes/activity'));
app.use('/api', require('./routes/notifications'));
app.use('/api', require('./routes/push'));
app.use('/api', (req, res) => res.status(404).json({ error: 'المسار المطلوب غير موجود' }));

const dist = path.join(__dirname, '..', '..', 'dashboard', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  if (String(err.code || '').startsWith('SQLITE_CONSTRAINT'))
    return res.status(400).json({ error: 'تعذّر تنفيذ العملية: البيانات مكررة أو مرتبطة بسجلات أخرى' });
  console.error(err);
  res.status(500).json({ error: 'حدث خطأ في الخادم، يرجى المحاولة لاحقًا' });
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`YMCReport API on :${port}`));
