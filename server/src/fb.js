// Facebook Graph reader. ONE env token for the whole server: FB_TOKEN (Business Manager -> System User,
// never expires). Unset -> every sync route 400s in Arabic, exactly like storage.js without B2 credentials.
//
// PAGES ONLY. A personal profile is unreadable by any token but its owner's, and even then Graph exposes
// neither a follower count nor a post count — profile.php?id= / /people/<name>/<id> links are recognised
// and never attempted. Manual «تحديث سريع» stays the fallback for those rows.
// ponytail: no per-account tokens, no OAuth flow, no retry/backoff, no scheduler. Upgrade path when asked.

const V = process.env.FB_API_VERSION || 'v26.0'; // pinned once — Meta expires a version on a ~2y clock
const TOKEN = process.env.FB_TOKEN || '';
const DAY = 864e5;
const LOOKBACK = 7 * DAY;   // always re-read a week: shares keep accruing on posts already counted
const MAX_BACK = 90 * DAY;  // a forgotten account still can't ask Graph for a year of feed

if (!TOKEN) console.warn('facebook sync disabled — FB_TOKEN not set');

// ---- errors -------------------------------------------------------------------------------------
// Arabic message per Graph error code. `gone` marks the ONE code that unambiguously means the object
// no longer exists, so the caller may flip status to مغلق. Code 100/subcode 33 is deliberately NOT
// `gone`: its own message says "does not exist, OR cannot be loaded due to missing permissions" —
// closing an account because our token lost a role would be a lie.
const CODES = {
  190: 'انتهت صلاحية رمز فيسبوك — حدّث FB_TOKEN في إعدادات الخادم',
  102: 'انتهت صلاحية رمز فيسبوك — حدّث FB_TOKEN في إعدادات الخادم',
  10: 'رمز فيسبوك لا يملك صلاحية قراءة هذه الصفحة',
  200: 'رمز فيسبوك لا يملك صلاحية قراءة هذه الصفحة',
  283: 'رمز فيسبوك لا يملك صلاحية قراءة منشورات هذه الصفحة',
  492: 'رمز فيسبوك لا يملك دورًا على هذه الصفحة — أضفه في Business Manager',
  100: 'تعذّر قراءة هذه الصفحة — تحقق من الرابط أو من صلاحيات الرمز',
  803: 'لم يتم العثور على الصفحة على فيسبوك — تحقق من الرابط',
  4: 'تم تجاوز حد طلبات فيسبوك — حاول بعد قليل',
  17: 'تم تجاوز حد طلبات فيسبوك — حاول بعد قليل',
  32: 'تم تجاوز حد طلبات فيسبوك — حاول بعد قليل',
  613: 'تم تجاوز حد طلبات فيسبوك — حاول بعد قليل',
  80001: 'تم تجاوز حد طلبات فيسبوك — حاول بعد قليل',
};

class FbError extends Error {
  constructor(message, { code = null, gone = false } = {}) {
    super(message);
    this.code = code;
    this.gone = gone;
  }
}

// ---- link -> Graph node -------------------------------------------------------------------------
// Pure parsing, no network: Graph accepts a vanity alias exactly where it accepts a numeric id, so
// there is no resolution pass and no fb_object_id column. Returns null when the link is not a
// readable Facebook object at all.
const SKIP = new Set(['groups', 'events', 'share', 'sharer.php', 'reel', 'watch', 'marketplace', 'story.php', 'photo.php', 'permalink.php']);

function node(link) {
  if (!link) return null;
  let u;
  try {
    u = new URL(String(link).trim().replace(/^(?!https?:\/\/)/i, 'https://'));
  } catch {
    return null;
  }
  if (!/^(?:[\w-]+\.)*(?:facebook\.com|fb\.com|fb\.me)$/i.test(u.hostname)) return null;

  // /profile.php?id=100…  — a personal profile, never attempted
  const qid = u.searchParams.get('id');
  if (/\/profile\.php$/i.test(u.pathname) && qid) return { id: qid, profile: true };

  const seg = u.pathname.split('/').filter(Boolean);
  if (!seg.length) return null;
  if (SKIP.has(seg[0].toLowerCase())) return null;
  // /people/Some-One/61551…  — also a personal profile
  if (seg[0].toLowerCase() === 'people') return seg[2] ? { id: seg[2], profile: true } : null;
  // /pages/Some-Name/1234567890  and  /pg/<vanity>/posts
  if (seg[0].toLowerCase() === 'pages') return seg[2] ? { id: seg[2] } : null;
  const id = seg[0].toLowerCase() === 'pg' ? seg[1] : seg[0];
  // a real vanity alias or numeric id is [A-Za-z0-9._-]; anything else never reaches the URL builder
  if (!id || /\.php$/i.test(id) || !/^[A-Za-z0-9._-]+$/.test(id)) return null;
  // ponytail: a bare numeric first segment is attempted — a Page id and a user id are indistinguishable
  // here, and refusing it would hide real Pages. Graph answers with 803/100 if we guessed wrong.
  return { id };
}

// ---- graph --------------------------------------------------------------------------------------
async function call(path, params = {}) {
  const url = new URL(`https://graph.facebook.com/${V}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('access_token', TOKEN);
  let res;
  try {
    // Node 20 fetch has NO default timeout — a hung socket would pin the request forever
    res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  } catch (e) {
    throw new FbError(e.name === 'TimeoutError'
      ? 'انتهت مهلة الاتصال بفيسبوك — حاول مرة أخرى'
      : 'تعذّر الاتصال بفيسبوك — تحقق من اتصال الخادم بالإنترنت');
  }
  const body = await res.json().catch(() => null);
  // Graph answers 200 with an error object often enough that status alone is not a check
  if (body?.error) {
    const { code, message } = body.error;
    throw new FbError(CODES[code] || `فيسبوك: ${message || 'خطأ غير معروف'}`, { code, gone: code === 803 });
  }
  if (!res.ok || !body) throw new FbError(`تعذّرت قراءة البيانات من فيسبوك (HTTP ${res.status})`);
  return body;
}

const localDay = (d) => new Date(d).toLocaleDateString('en-CA'); // matches notify.js day(); set TZ on the host

// One target -> everything a sync writes. `seen` is the previous per-post baseline, so engagement is
// accumulated as a delta (Σ max(0, now - then)) rather than overwritten: a deleted post never subtracts
// and a sliding window never walks the number backwards.
async function fetchMetrics(id, seen, lastCheckedAt) {
  const now = Date.now();
  const last = lastCheckedAt ? Date.parse(String(lastCheckedAt).replace(' ', 'T') + 'Z') : NaN;
  const since = Math.floor(Math.max(now - MAX_BACK, Math.min(last || now, now - LOOKBACK)) / 1000);

  const info = await call(id, { fields: 'name,followers_count' });
  const feed = await call(`${id}/published_posts`, {
    // ponytail: one page of 100 — a Page posting >100 times inside the window under-counts that run.
    fields: 'id,created_time,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)',
    since, until: Math.floor(now / 1000), limit: 100,
  });

  const prev = seen || {};
  const next = {};
  const today = localDay(now);
  let posts = 0, shares = 0, reactions = 0, comments = 0, postsToday = 0;
  for (const p of feed.data || []) {
    // Graph OMITS shares entirely when it is zero
    const cur = [p.shares?.count ?? 0, p.reactions?.summary?.total_count ?? 0, p.comments?.summary?.total_count ?? 0];
    const was = prev[p.id];
    next[p.id] = cur;
    if (!was) posts++;
    shares += Math.max(0, cur[0] - (was?.[0] ?? 0));
    reactions += Math.max(0, cur[1] - (was?.[1] ?? 0));
    comments += Math.max(0, cur[2] - (was?.[2] ?? 0));
    if (p.created_time && localDay(p.created_time) === today) postsToday++;
  }
  return {
    name: info.name ?? null,
    // absent (not 0) when Graph withheld it — a login-walled zero would collapse the followers chart
    followers: typeof info.followers_count === 'number' ? info.followers_count : null,
    posts, shares, reactions, comments, postsToday, seen: next,
  };
}

// ---- health -------------------------------------------------------------------------------------
// Drives the Accounts banner and every disabled sync control: the "degrade honestly" requirement.
let cached = null, cachedAt = 0;
async function health() {
  if (!TOKEN) return { connected: false, name: null, error: 'لم يتم ضبط FB_TOKEN على الخادم' };
  if (cached && Date.now() - cachedAt < 3e5) return cached; // 5 min — a page load must not cost a Graph call
  try {
    const me = await call('me', { fields: 'name' });
    cached = { connected: true, name: me.name ?? null, error: null };
  } catch (e) {
    cached = { connected: false, name: null, error: e.message };
  }
  cachedAt = Date.now();
  return cached;
}

module.exports = { node, fetchMetrics, health, FbError, enabled: () => !!TOKEN };
