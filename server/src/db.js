const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const db = new Database(process.env.DB_PATH || path.join(__dirname, '..', 'data.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// no CHECK on kind (SQLite can't alter one) — the enum is enforced in notify.js; same DDL drives the rebuild below
const NOTIF_DDL = `(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, key))`;

db.exec(`
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super','admin','user')),
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS account_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  allows_pages INTEGER NOT NULL DEFAULT 0,
  UNIQUE (group_id, name));
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT,
  UNIQUE (group_id, name));
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type_id INTEGER NOT NULL REFERENCES account_types(id),
  site_id INTEGER REFERENCES sites(id),
  name TEXT NOT NULL,
  mobile TEXT, email TEXT,
  password TEXT,
  link TEXT, profile_address TEXT, profile_work TEXT, notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  followers INTEGER, posts_count INTEGER, last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (mobile IS NOT NULL OR email IS NOT NULL));
CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT, address TEXT, work TEXT, note TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  followers INTEGER, posts_count INTEGER, last_checked_at TEXT);
CREATE TABLE IF NOT EXISTS account_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS ix_account_events ON account_events(account_id, id);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('publish','create_account','interact','general')),
  title TEXT NOT NULL,
  description TEXT,
  type_id INTEGER REFERENCES account_types(id),
  post_count INTEGER,
  category TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  due_date TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS subtasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT,
  actions TEXT);
CREATE TABLE IF NOT EXISTS interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  subtask_id INTEGER REFERENCES subtasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  done INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  actions_done TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE UNIQUE INDEX IF NOT EXISTS ux_interaction ON interactions(task_id, user_id, COALESCE(subtask_id, 0));
CREATE TABLE IF NOT EXISTS notifications ${NOTIF_DDL};
CREATE INDEX IF NOT EXISTS ix_notifications ON notifications(user_id, id);
CREATE TABLE IF NOT EXISTS sim_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  carrier TEXT NOT NULL CHECK (carrier IN ('jawwal','ooredoo')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','lost')),
  holder_name TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, number));
CREATE INDEX IF NOT EXISTS ix_sim_lines_user ON sim_lines(user_id);
CREATE TABLE IF NOT EXISTS entity_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('account','page','sim')),
  entity_id INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS ix_entity_notes ON entity_notes(entity_type, entity_id, id);
`);

// migrate pre-existing DBs: add tasks columns missing from older schemas
// (ALTER ADD COLUMN can't carry CHECK — priority enum enforced in routes/tasks.js)
const taskCols = new Set(db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name));
for (const [col, ddl] of Object.entries({
  category: 'category TEXT',
  priority: "priority TEXT NOT NULL DEFAULT 'normal'",
  due_date: 'due_date TEXT',
  archived: 'archived INTEGER NOT NULL DEFAULT 0',
})) if (!taskCols.has(col)) db.exec(`ALTER TABLE tasks ADD COLUMN ${ddl}`);

for (const [table, col] of [['subtasks', 'actions'], ['interactions', 'actions_done']])
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col))
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT`);

// tracking columns on accounts/pages (status enum enforced in routes/accounts.js)
for (const table of ['accounts', 'pages']) {
  const cols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [col, ddl] of Object.entries({
    status: "status TEXT NOT NULL DEFAULT 'active'",
    followers: 'followers INTEGER',
    posts_count: 'posts_count INTEGER',
    last_checked_at: 'last_checked_at TEXT',
  })) if (!cols.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

// older DBs carry a CHECK enum on notifications.kind; SQLite can't drop it → rebuild the table once
// (rows copied, UNIQUE(user_id, key) + index recreated). No-op once the stored DDL has no CHECK.
if ((db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notifications'").get()?.sql ?? '').includes('CHECK'))
  db.transaction(() => db.exec(`CREATE TABLE notifications_new ${NOTIF_DDL};
    INSERT INTO notifications_new SELECT * FROM notifications; DROP TABLE notifications;
    ALTER TABLE notifications_new RENAME TO notifications;
    CREATE INDEX ix_notifications ON notifications(user_id, id);`))();

if (!db.prepare("SELECT 1 FROM users WHERE role = 'super'").get()) {
  db.prepare('INSERT INTO users (username, password_hash, name, role) VALUES (?,?,?,?)')
    .run('super', bcrypt.hashSync('super123', 10), 'Super', 'super');
  console.log('Seeded super user -> username: super  password: super123');
}

module.exports = db;
