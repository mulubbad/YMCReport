# YMCReport — System Contract (source of truth)

Work-tracking system: groups of users manage social accounts and complete admin-assigned tasks. Admins/supers export Excel reports.

## Stack
- `server/` — Node (plain JS, CommonJS), Express 4, better-sqlite3, jsonwebtoken, bcryptjs, exceljs, cors. Port **3001** (env `PORT`). DB file `server/data.db` (env `DB_PATH`).
- `dashboard/` — Vite + React + TypeScript, Tailwind v4, shadcn/ui (path alias `@` → `src`). Dev proxy `/api` → `http://localhost:3001`.
- Server also serves `../dashboard/dist` statically if it exists (SPA fallback to index.html for non-/api routes).

## Roles
- `super` — everything, across all groups. Seeded on first run: username `super` / password `super123` (log it on create).
- `admin` — manages ONE group: its users (role `user` only), account types, sites, tasks; sees all group accounts; exports.
- `user` — manages own social accounts + pages; checks off tasks with notes.

## SQLite schema
```sql
PRAGMA foreign_keys = ON;
CREATE TABLE groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super','admin','user')),
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE account_types (           -- admin-defined allowed social types per group
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                  -- e.g. facebook, x, instagram
  allows_pages INTEGER NOT NULL DEFAULT 0,
  UNIQUE (group_id, name));
CREATE TABLE sites (                   -- admin-defined allowed sites per group
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT,
  UNIQUE (group_id, name));
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type_id INTEGER NOT NULL REFERENCES account_types(id),
  site_id INTEGER REFERENCES sites(id),
  name TEXT NOT NULL,                  -- account name
  mobile TEXT, email TEXT,             -- credentials: at least one required
  password TEXT,
  link TEXT, profile_address TEXT, profile_work TEXT, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (mobile IS NOT NULL OR email IS NOT NULL));
CREATE TABLE pages (                   -- sub-accounts; only for types with allows_pages=1
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT, address TEXT, work TEXT, note TEXT);
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('publish','create_account','interact','general')),
  title TEXT NOT NULL,
  description TEXT,
  type_id INTEGER REFERENCES account_types(id),  -- target type (publish / create_account)
  post_count INTEGER,                            -- publish: posts per account
  category TEXT,                                 -- free-text label; UI suggests existing ones
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  due_date TEXT,                                 -- ISO date, nullable
  archived INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
-- db.js migrates existing DBs: ALTER TABLE tasks ADD COLUMN for any of the 4 columns missing (check pragma table_info)
CREATE TABLE subtasks (                -- e.g. "like this post", "share to group X"
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT,
  actions TEXT);                       -- JSON array of required actions, nullable; keys: react|comment|share_profile|share_group|follow
-- migration: ALTER TABLE subtasks ADD COLUMN actions / interactions ADD COLUMN actions_done when missing
-- Arabic labels: react=إعجاب، comment=تعليق، share_profile=مشاركة، share_group=مشاركة في مجموعة، follow=متابعة
CREATE TABLE interactions (            -- per-user done/notes, per task or per subtask
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  subtask_id INTEGER REFERENCES subtasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  done INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  actions_done TEXT,                   -- JSON array ⊆ the subtask's actions, nullable
  updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE UNIQUE INDEX ux_interaction ON interactions(task_id, user_id, COALESCE(subtask_id, 0));
```

## API (all under `/api`, JSON)
Auth: `Authorization: Bearer <jwt>`. JWT payload `{ id, role, group_id }`, secret env `JWT_SECRET` (dev fallback constant), expiry 7d. Errors: status 400/401/403/404 + body `{ "error": "message" }`. Inactive users can't log in.

| Endpoint | Access | Notes |
|---|---|---|
| POST /login | public | `{username,password}` → `{token, user}` (user = id, username, name, role, group_id) |
| GET /me | any | → user row (no hash) |
| GET /groups | super | list with `user_count` |
| POST/PUT/DELETE /groups(/:id) | super | `{name}` |
| GET /users | admin/super | admin: own group; super: all, optional `?group_id` |
| POST /users | admin/super | `{username,password,name,role?,group_id?}`; admin: forced role `user` + own group; super: any |
| PUT /users/:id | self/admin/super | self: `{name,password}` only; admin: own-group users; super: anyone incl. `role`,`group_id`,`active` |
| DELETE /users/:id | admin/super | admin: own-group `user` rows only |
| GET /types, /sites | any | own group (super: `?group_id`) |
| POST/PUT/DELETE /types(/:id), /sites(/:id) | admin/super | admin: own group. types: `{name, allows_pages}`; sites: `{name, url}` |
| GET /accounts | any | user: own; admin: group (`?user_id` filter); super: all (`?group_id`,`?user_id`). Each row includes `type_name`, `allows_pages`, `site_name`, `owner_name`, `page_count` |
| POST /accounts | any | for self; admin/super may pass `user_id` (must be in scope). Validate: type belongs to owner's group; mobile-or-email required |
| PUT/DELETE /accounts/:id | owner/group-admin/super | |
| GET /accounts/:id/pages | account scope | |
| POST /accounts/:id/pages | account scope | 400 if type `allows_pages` = 0 |
| PUT/DELETE /pages/:id | account scope | |
| GET /tasks | any | group tasks (super: `?group_id`). Default active only; `?archived=1` → archived only. Each: `subtasks[]`, `progress:{done,total}` (users in group who completed = done on task itself, or on ALL subtasks if any exist), and `mine:{done,notes}` + per-subtask `mine` for the caller; incl. category/priority/due_date/archived |
| POST /tasks | admin/super | `{kind,title,description,type_id,post_count,category,priority,due_date,subtasks:[{title,url}]}` |
| PUT /tasks/:id | admin/super | same body; subtasks: update by `id`, insert new, delete missing (preserves interactions) |
| PUT /tasks/:id/archive | admin/super | `{archived: 0\|1}` — group-scoped |

Subtask bodies in POST/PUT /tasks are `{id?, title, url, actions?: string[]}` (keys validated against the enum). GET /tasks returns `actions` parsed as an array (null → []) and each `mine` includes `actions_done: string[]`. PUT /tasks/:id/interactions accepts optional `actions_done: string[]` (validated ⊆ enum); when a subtask HAS actions, its `done` is DERIVED server-side: done = actions_done covers all required actions (client sends actions_done only; server sets done accordingly — keeps progress/export/badge logic unchanged). Subtasks without actions keep the manual done flag. GET /tasks/:id/interactions includes actions_done. Export interactions sheet gains column الإجراءات المنفذة (Arabic labels joined by ، ).
| DELETE /tasks/:id | admin/super | |
| GET /tasks/:id/interactions | admin/super | all members' status incl. user_name, subtask_title |
| PUT /tasks/:id/interactions | user in group | `{subtask_id?, done, notes}` upsert own row |
| GET /stats | any | role-scoped: `{users, accounts, pages, tasks, completion, my_pending}` (completion = % of member×task pairs done; `my_pending` = ACTIVE tasks in caller's group the caller hasn't completed — same all-subtasks rule as progress; 0 when caller has no group) + `accounts_by_type:[{name,count}]`. Sidebar shows `my_pending` as a badge on المهام (hidden at 0; Layout refetches on route change and on the `ymc:refresh` window event, which Tasks fires after any save) |
| GET /export | admin/super | **Excel download** — see below |

## Excel export (`GET /api/export`)
Query params: `sheets` (csv of `accounts,pages,tasks,interactions,summary`, default all), `user_ids`, `type_ids` (csv filters), `from`, `to` (ISO date, filters tasks by created_at & interactions by updated_at), `group_id` (super only; admin fixed to own group).
Response: `.xlsx` attachment `report-<date>.xlsx`. exceljs. Every sheet: bold white-on-indigo (`FF4F46E5`) header row, frozen top row, autoFilter, sensible column widths.
- **Accounts**: Owner, Type, Site, Account Name, Mobile, Email, Password, Link, Profile Address, Profile Work, Pages, Notes, Created
- **Pages**: Owner, Account, Type, Page Name, URL, Address, Work, Note
- **Tasks**: Title, Kind, Target Type, Post Count, Subtasks, Done/Total, Completion %
- **Interactions**: Task, Subtask, User, Done (Yes/No), Notes, Updated
- **Summary**: one row per user — Name, Accounts, then a column per account type (counts), Tasks Done/Total, Completion %

## Frontend contract (dashboard/src)
- `lib/api.ts` — `api.get/post/put/del(path)` fetch wrapper: prefixes `/api`, Bearer token from `localStorage.token`, throws `Error(body.error)` on !ok; plus `api.download(path)` (fetch → blob → anchor click) for export.
- `lib/auth.tsx` — `AuthProvider` + `useAuth()` → `{ user, login(username,password), logout }`; user cached in localStorage; 401 anywhere → logout.
- `components/Layout.tsx` — sidebar shell (role-filtered nav, lucide icons, active state), user menu w/ logout, dark-mode toggle (class on `<html>`, persisted).
- Routes (react-router): `/login`; inside Layout+auth guard: `/` Dashboard, `/accounts` Accounts, `/tasks` Tasks, `/users` Users (admin/super), `/groups` Groups (super), `/settings` Settings=types+sites (admin/super), `/export` Export (admin/super). Role-gate via a `RequireRole` wrapper.
- Pages live in `src/pages/<Name>.tsx`, one file per route, default export.
- Toasts: sonner (`toast.success/error`). All mutations confirm destructive deletes with alert-dialog.

## Design
shadcn "new-york", base color neutral, CSS-variable theming, **primary = indigo-600** (dark mode indigo-500), light + dark supported. Dense, professional admin density: compact tables, `text-sm` defaults. Icons: lucide-react only — never emoji.

**Language: Arabic, RTL — the whole system.** `<html lang="ar" dir="rtl">`, font IBM Plex Sans Arabic, Radix `DirectionProvider dir="rtl"`. UI strings hardcoded Arabic (single language, no i18n lib); code identifiers, routes, JSON fields, and DB enums stay English — enums map to Arabic labels at display time (نشر/إنشاء حساب/تفاعل/عام؛ مشرف عام/مدير مجموعة/عضو). Server `{error}` messages are Arabic (they surface in toasts). Excel export: Arabic sheet names/headers, `views:[{rightToLeft:true}]`, ASCII filename. Directional CSS uses logical utilities only (`ms-/me-/ps-/pe-/start-/end-/text-start`). Latin digits.

## Account tracking (smart trackability)
Schema additions (migrate existing DBs via pragma table_info + ALTER ADD COLUMN; enums enforced in routes):
- `accounts` + `pages`: `status TEXT NOT NULL DEFAULT 'active'` (active|restricted|suspended|closed), `followers INTEGER`, `posts_count INTEGER`, `last_checked_at TEXT`.
- `account_events` (auto audit trail): `id, account_id → accounts ON DELETE CASCADE, page_id → pages ON DELETE SET NULL, user_id → users ON DELETE SET NULL (actor), kind TEXT (created|updated|status|metrics|note|page_created|page_updated|page_deleted|checked), summary TEXT NOT NULL (Arabic, human-readable, never includes password values), data TEXT (JSON: field diff {field:{from,to}} or metrics {followers,posts_count}), created_at`.
Labels: status active=نشط، restricted=مقيّد، suspended=موقوف، closed=مغلق. Kinds: created=إنشاء، updated=تعديل، status=تغيير الحالة، metrics=تحديث الإحصائيات، note=ملاحظة، page_created=إضافة صفحة، page_updated=تعديل صفحة، page_deleted=حذف صفحة، checked=فحص.
API:
- GET /accounts rows add `status, followers, posts_count, last_checked_at, prev_followers` (followers value from the metrics event before the latest one; null if none). Pages rows add the same 4 fields.
- POST/PUT /accounts(:id) and pages accept status/followers/posts_count. Every mutation logs events automatically: create → created; PUT → `updated` with a diff summary ("تم تعديل: الاسم، البريد الإلكتروني"; password change noted as "كلمة المرور" with no values), status change → `status`, followers/posts_count change → `metrics` (+ sets last_checked_at = now); page create/update/delete → page_* on the parent account with page_id.
- POST /accounts/:id/updates and POST /pages/:id/updates `{followers?, posts_count?, status?, note?}` — quick update: applies given fields, sets last_checked_at = now, logs metrics/status/note events (nothing given → `checked` "تم فحص الحساب"). Returns the updated row (list shape).
- GET /accounts/:id/events (?limit=100, default 100) → newest first, with `actor_name`, `page_name`; same scope rules as the account. Rows include `page_id` (null for account-level events). Account-level metrics (`prev_followers`, the UI followers chart) consider only events with `page_id` null — page readings never pollute the account series.
- GET /stats adds `accounts_attention` = in-scope accounts with status ≠ active OR last_checked_at null OR older than 14 days (ponytail: 14d constant `STALE_DAYS`, shared by UI).
- Export: accounts + pages sheets add الحالة، المتابعون، عدد المنشورات، آخر فحص; new sheet key `events` "سجل التحديثات" (التاريخ، الحساب، الصفحة، المستخدم، النوع، الوصف), honoring user/type/date filters.
UI (Accounts page): quick-filter chips الكل / نشطة / تحتاج متابعة / غير نشطة; list shows status badge, followers with delta arrow vs prev_followers, last check relative time (red when stale/never); account profile dialog with tabs التفاصيل / الصفحات / النشاط (timeline) / الإحصائيات (followers SVG sparkline + growth %); quick-update dialog (تحديث سريع) for accounts and pages; copy-to-clipboard on credentials.

## Team collaboration on tasks
Schema (created idempotently by `routes/tasks.js`): `task_comments (id, task_id → tasks ON DELETE CASCADE, user_id → users ON DELETE SET NULL, body TEXT NOT NULL, created_at)` + index `(task_id, id)`.
API:
- GET /tasks rows add `created_by_name` (null if creator deleted), `comment_count`, and `done_ids` (member ids counted in `progress.done`).
- GET /tasks/team (any; super: `?group_id`) → `{ group:{id,name}|null, tasks (active count), members:[{id,name,done,total}] (role user, active; done = active tasks completed under the all-subtasks rule), admins:[{id,name}] }`. Empty shape when caller has no group.
- GET /tasks/:id/comments (group scope or super) → rows + `user_name`, `user_role`, oldest first.
- POST /tasks/:id/comments `{body}` (group scope or super; trimmed, 1–2000 chars) → row.
- DELETE /comments/:id — own comment, or admin/super in scope.
UI (Tasks page): "نبض الفريق" card (group name, members' completion rings, team % bar, Trophy on top performer, "أنت" highlight) visible to admin+users of a group; admin-only "ملخص الأسبوع" builds a 3P text (التقدم/الخطط/المشكلات) from the loaded tasks + team (copy / navigator.share). **Compact Jira-style cards**: kind icon tile, title (click = expand), status badge from the derived category `laneOf(complete, started, dayDiff)`: مكتملة / متأخرة (due < today) / قريبة الاستحقاق (≤3d) / قيد التنفيذ (started) / لم تبدأ — meta line (kind · category · عالية badge · compact due chip · creator · relative time), then a tracking row: `MemberStack` avatars (done = success tick, pending = muted initials; click → تفاصيل الإنجاز for admins), "n/total أنجزوا", member quick toggle (checkbox when no subtasks / segmented n/m when subtasks), "نقاش" count, admin "⋯" menu (تفاصيل الإنجاز / تعديل / أرشفة|استعادة / حذف). Details collapse by default for admins and for completed tasks; members' pending tasks open expanded (subtask rows + notes; with subtasks there is no task-level checkbox). Cards ⇄ board toggle (board = one lane per category, persisted in `localStorage.tasksView`); status chips/filter use the same 5 categories + "غير مكتملة". تفاصيل الإنجاز dialog lists EVERY member (from /tasks/team) with منجز / قيد التنفيذ / لم يبدأ. Comments dialog: chat bubbles, @mention picker from team admins+members, Ctrl+Enter send, delete own/admin with confirm. Comments are not exported. Sidebar nav is grouped into sections (نظرة عامة / العمل / الإدارة / التقارير); sections with no role-visible items are hidden.

## Notifications (polling, in-app)
Table `notifications`: `id, user_id → users ON DELETE CASCADE, key TEXT NOT NULL, kind TEXT (task_new|task_due_soon|task_overdue|task_done|account_stale|account_status|task_nudge|message — CHECK enum; db.js rebuilds older tables once), title TEXT NOT NULL, body TEXT, link TEXT (SPA route), read INTEGER NOT NULL DEFAULT 0, created_at`; `UNIQUE(user_id, key)` (idempotent generation via INSERT OR IGNORE), index (user_id, id).
Generation — helper `notify(userIds, {key, kind, title, body, link})`:
- POST /tasks → every active member of the task's group except the creator: `task_new`, key `task:{id}:new`, title "مهمة جديدة: {title}", body = kind label (+ "الاستحقاق {due_date}" when set), link `/tasks`.
- PUT /tasks/:id/interactions → when the caller's completion of the task flips to complete (same all-subtasks rule as progress): group admins (role admin, same group) except the caller: `task_done`, key `task:{id}:done:{userId}`, title "إنجاز مهمة: {title}", body "بواسطة {name}" (+ notes), link `/tasks`.
- Account status changed to ≠ active (PUT or quick update): group admins except the actor, plus the owner when actor ≠ owner: `account_status`, key `account:{id}:status:{status}:{YYYY-MM-DD}`, title "تغيّرت حالة الحساب: {name}", body "الحالة الجديدة: {label}", link `/accounts`.
- Poll-time derived (run for the caller at the start of GET /notifications; cheap queries, INSERT OR IGNORE): active tasks in caller's group not completed by caller with due_date = today or tomorrow → `task_due_soon` key `task:{id}:due_soon:{due_date}` title "مهمة تستحق قريبًا: {title}" body "الاستحقاق {due_date}"; due_date < today → `task_overdue` key `task:{id}:overdue:{due_date}` title "مهمة متأخرة: {title}" body "كانت تستحق في {due_date}". Accounts owned by the caller that are stale (never checked or last_checked_at older than STALE_DAYS) → `account_stale` key `account:{id}:stale:{ISO week YYYY-Www}` title "حساب يحتاج فحصًا: {name}" body "آخر فحص: {date | لم يُفحص بعد}" link `/accounts`.
API: `GET /notifications?limit=30&before=<id>&unread=1&kind=<kind>` → `{ unread, items: [{id, kind, title, body, link, read, created_at}], next }` newest first (derived generators run first); `next` = the last item's id when more rows exist (pass back as `before`), else null. `PUT /notifications/read` with `{ids:[...]}` or `{all:true}` → `{ unread }`.
Frontend (Layout): poll every 30s while the tab is visible (pause when hidden; refetch immediately on visibilitychange→visible and on `ymc:refresh`); bell button with unread badge (cap 99+); dropdown panel "الإشعارات" listing items (icon + tint per kind: task_new=ClipboardPlus primary, task_due_soon=Clock warning, task_overdue=AlertTriangle danger, task_done=CheckCircle2 success, account_stale=ScanSearch warning, account_status=ShieldAlert danger; title, body, relative time, unread dot), "تحديد الكل كمقروء"; clicking an item marks it read and navigates to `link`; items that are new since the previous poll (never on the first fetch) → sonner toast per item (max 3, then one "+N إشعارات أخرى"); `document.title` prefixed "(n) " while unread > 0; empty state "لا توجد إشعارات".
Archive page `/notifications` (nav item "الإشعارات" in the sidebar, and "عرض كل الإشعارات" in the bell panel footer): Metronic card; quick chips الكل / غير المقروءة + kind Select; list grouped by day (اليوم / أمس / date) with the same kind icon tiles, unread dot, relative time; row click marks read + navigates; header actions "تحديد الكل كمقروء"; "تحميل المزيد" cursor pagination via `next`; empty + skeleton states.

## Manager dashboard + report screen
**GET /stats?from=YYYY-MM-DD&to=YYYY-MM-DD&group_id=** — existing keys unchanged (users, accounts, pages, tasks, completion, my_pending, accounts_attention, accounts_by_type). For admin/super add `detail` (admin: own group only, `group_id` ignored; super: all groups, or one when `group_id` given). Defaults: from = to − 29 days, to = today; range capped at 366 days. Definitions: a member "completed" a task when the progress rule holds (done on the task, or on all subtasks); `completed_at` = max(updated_at) of that member's done interactions; on-time = completed_at ≤ due_date (only tasks with due_date count in the on-time denominator); overdue = active, non-archived task past due_date not completed by that member. Health = round(0.4·completion + 0.3·on_time_rate + 0.2·max(0, 100 − overdue_pct) + 0.1·max(0, 100 − attention_pct)) where overdue_pct = overdue member-task pairs ÷ active member-task pairs, attention_pct = attention accounts ÷ accounts; label ≥80 ممتاز (success) · ≥60 جيد (primary) · ≥40 يحتاج متابعة (warning) · <40 حرج (danger).
```
detail: {
  range: {from, to},
  kpis: { tasks_created, completions, completion_rate, on_time_rate, overdue, due_soon, avg_overdue_days, active_members, accounts_by_status: {active, restricted, suspended, closed} },
  series: [{date, created, completed}]            // one entry per day in range (completions = member-task completions whose completed_at is that day)
  tasks_by_kind: [{kind, total, completion}],
  groups: [{id, name, members, accounts, tasks, completion, on_time_rate, overdue, attention, health}],   // super: all (or the selected one); admin: own group
  members: [{id, name, group_name, done, total, completion, on_time_rate, overdue, attention}],           // sorted by completion desc, top 20
  attention: [{type: 'task'|'account', id, title, detail, severity: 'danger'|'warning', link}],          // top 10: overdue tasks (detail "متأخرة منذ N يوم"), non-active / stale accounts
  recent: [{id, kind, summary, account_name, actor_name, created_at}]                                    // last 10 account_events in scope
}
```
Counts users/accounts/pages are snapshots; tasks_created/completions/series/on_time/health are computed inside the range (tasks by created_at, completions by completed_at).
**GET /report?sheet=accounts|pages|tasks|interactions|summary|events** + the export filters (`user_ids, type_ids, from, to, group_id`) + `limit` (default 500, max 2000) → `{ sheet, title, columns: [Arabic headers], rows: [[cell, ...]], total }` — EXACTLY the same columns/values as the Excel sheet (export.js sheet builders return `{title, columns, rows}` and both the xlsx route and /report consume them).
**Dashboard (admin/super)**: signature element = the date-range strip: a full-width day-by-day activity strip (bars = completions per day, faint = created) that doubles as the filter — preset chips (7 أيام / 30 يوماً / 90 يوماً / هذا الشهر) + من/إلى date inputs + group select (super); everything below recomputes from the range. Then: KPI tiles (quiet, tabular-nums, each with a one-line delta/label), group health cards (ring gauge + label + مهام/اكتمال/في الوقت/متأخرة), members table (sortable by completion), tasks-by-kind bars, attention list (icon+text severity), recent activity feed, link to التقارير. Members (role user) keep the simple view.
**Report screen (/export)**: builder + live preview — sheet tabs (the 6 sheets), the filters, a DataTable (client-side search, sortable columns with aria-sort, 25/50/100 page size, "عرض X من Y") fed by /report, and two actions: "تصدير Excel" (selected sheets, current filters — existing api.download) and "تصدير هذه الورقة".

## SIM lines (خطوط الاتصال) — Palestine (Jawwal / Ooredoo)
Table `sim_lines`: `id, user_id → users ON DELETE CASCADE, number TEXT NOT NULL (normalized 05XXXXXXXX), carrier TEXT NOT NULL (jawwal|ooredoo), status TEXT NOT NULL DEFAULT 'active' (active|inactive|lost), holder_name TEXT, notes TEXT, created_at, updated_at, UNIQUE(user_id, number)`.
Normalization (server, on POST/PUT): strip spaces/dashes/parentheses; `+970`, `00970`, `970`, `+972`, `00972`, `972` prefixes → leading `0`; result must match `^05[69]\d{7}$` else 400 "رقم الجوال غير صالح — يجب أن يبدأ بـ 059 (جوال) أو 056 (أوريدو)". Carrier is ALWAYS derived: `059…` → jawwal, `056…` → ooredoo (no client override). Labels: jawwal=جوال، ooredoo=أوريدو؛ status active=نشط، inactive=غير نشط، lost=مفقود.
API (scope rules identical to accounts: user → own, admin → group with `?user_id`, super → all with `?group_id`/`?user_id`; admin/super may pass `user_id` on POST for a member in scope):
- `GET /sims` → rows + `owner_name`, `linked_accounts` (count of in-scope accounts whose normalized `mobile` equals `number`).
- `POST /sims` `{number, status?, holder_name?, notes?, user_id?}` · `PUT /sims/:id` same fields · `DELETE /sims/:id` (owner/group-admin/super). Duplicate number for the same user → 400 "هذا الرقم مسجّل مسبقًا".
- Export/report: new sheet key `sims` "خطوط الاتصال" (المالك، الرقم، الشركة، الحالة، اسم المالك المسجّل، الحسابات المرتبطة، ملاحظات، أضيف في), filtered by `user_ids`/`group_id`; included in the default sheet set.
UI: page `/sims` (nav "خطوط الاتصال" under العمل, all roles): Metronic card, quick chips الكل / جوال / أوريدو / غير نشطة·مفقودة with counts, owner filter (admin/super), table (number in LTR tabular digits with copy button; carrier badge with brand tile — جوال green, أوريدو red; status badge icon+text; holder; linked accounts count; actions) + stacked mobile cards; dialog with a single number input that shows the detected carrier live (Jawwal/Ooredoo/—) and the validation hint, status select, holder_name, notes. Accounts dialog: the mobile input offers a `<datalist>` of the owner's SIM numbers.

## Nudge + private message (task popup)
- `POST /tasks/:id/nudge` (admin/super in scope) `{ user_ids?: number[], message? }` → reminds pending members (default: all not-completed members; `user_ids` filters to those) with kind `task_nudge`, key `task:{id}:nudge:{YYYY-MM-DD}` (≤1 reminder per member per task per day), title "تذكير: {title}", body = message (≤500) or "المهمة بانتظار إنجازك — الاستحقاق {due}. — {sender}", link `/tasks`. Returns `{ notified, skipped }` (skipped = already reminded today). 400 when nobody is pending.
- `POST /tasks/:id/message` (anyone in scope) `{ user_id, body }` → one `message` notification to that active same-group user (not self), title "رسالة خاصة من {sender}: {title}", body ≤1000, link `/tasks`. No thread table — replying is sending a message back.
- Notification kinds gain `task_nudge` (BellRing, warning) and `message` (MessageCircle, info) in both the bell panel and the archive page.
UI: task popup (click title / open icon / subtask progress on a card) — header (kind tile, title, meta, status/priority/due chips, نقاش), الوصف, قائمة التنفيذ (interactive for members, read-only for admins/archive), حالتي (quick toggle + notes), side panel with fields and "إنجاز الفريق": every member with منجز / لم ينجز. Admins: "تنبيه من لم ينجز (n)" + per-pending-member تنبيه, per-member رسالة خاصة; members: "رسالة خاصة" with recipient select (admins first). Admin footer: تفاصيل الإنجاز / تعديل / أرشفة / حذف (close the popup first). Super (no group) loads `/tasks/team?group_id=` once per group present in the lists, so avatar stacks, the popup roster, @mentions and nudge/message work per task's group; the team-pulse card stays admin/member only. Roster actions are labelled light buttons (تنبيه warning-tint, رسالة info-tint) under each member's name. Cards remount when the popup closes so toggles made inside it show on the card.

## Private notes (ملاحظات خاصة) on accounts / pages / SIM lines
A private thread per entity between the entity's owner (member) and the leaders of that member's group (role admin) + super. No other member can read it.
Table `entity_notes`: `id, entity_type TEXT NOT NULL (account|page|sim), entity_id INTEGER NOT NULL, user_id → users ON DELETE SET NULL (author), body TEXT NOT NULL, created_at`; index (entity_type, entity_id, id). Owner resolution: account → accounts.user_id; page → its account's user_id; sim → sim_lines.user_id. Access = owner, admins of the owner's group, super; else 403. Labels: account=الحساب، page=الصفحة، sim=خط الاتصال.
API:
- `GET /notes?type=<account|page|sim>&id=<entityId>` → `[{id, body, author_id, author_name, author_role, created_at}]` oldest first.
- `POST /notes` `{type, id, body}` (body trimmed, 1–2000 chars else 400) → the created note. Notifies the counterpart(s) with kind `message`: author is the owner → the group's admins; author is admin/super → the owner (and other admins of that group except the author); key `note:{noteId}`, title "ملاحظة خاصة على {label}: {entity name}", body = first 120 chars, link `/accounts` for account/page, `/sims` for sim.
- `DELETE /notes/:id` — author or super.
- List rows gain `note_count`: GET /accounts, GET /accounts/:id/pages, GET /sims.
- `notifications.kind` must accept `message` and `task_nudge` (the dashboard already renders them): drop the CHECK constraint via a one-time table rebuild migration (create new table without CHECK → copy rows → drop old → rename; keep the UNIQUE(user_id,key) + index); enforce the kind list in `notify()` instead.
UI: one reusable `<NotesThread type id title />` (chat-style: author initials tile, name + role light-badge, body with preserved line breaks, relative time; own notes deletable; composer Textarea + "إرسال" (Ctrl/⌘+Enter); privacy hint line "هذه الملاحظات مرئية لك ولقائد الفريق فقط" (member) / "مرئية لك وللعضو فقط" (leader); empty state inviting the first note; dispatch `ymc:refresh` after send). Accounts profile dialog gets a tab "الملاحظات الخاصة" (count badge) and each row a MessageSquare action with the count; pages (inside the profile's الصفحات tab) and SIM rows get the same action opening a dialog with the thread.
