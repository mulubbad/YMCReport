const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
require('./db');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', require('./routes/core'));
app.use('/api', require('./routes/meta'));
app.use('/api', require('./routes/accounts'));
app.use('/api', require('./routes/sims'));
app.use('/api', require('./routes/notes'));
app.use('/api', require('./routes/tasks'));
app.use('/api', require('./routes/export'));
app.use('/api', require('./routes/notifications'));
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
