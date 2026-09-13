// node server/src/fb.check.js — the link parser is the only real branching logic in fb.js.
// Mirrors dashboard/src/lib/utils.check.ts: asserts, no framework.
const assert = require('assert');
const { node } = require('./fb');

const id = (u) => node(u)?.id ?? null;

// pages: vanity alias or numeric id, any Facebook host, any trailing path
assert.equal(id('https://facebook.com/YMCPage'), 'YMCPage');
assert.equal(id('https://www.facebook.com/YMCPage/'), 'YMCPage');
assert.equal(id('https://www.facebook.com/pg/YMCPage/posts/'), 'YMCPage');
assert.equal(id('https://m.facebook.com/YMCPage/about'), 'YMCPage');
assert.equal(id('https://web.facebook.com/YMCPage?ref=bookmarks'), 'YMCPage');
assert.equal(id('https://m.facebook.com/pages/Some-Name/1234567890'), '1234567890');
assert.equal(id('  https://fb.com/YMCPage?ref=x  '), 'YMCPage');
assert.equal(id('facebook.com/YMCPage'), 'YMCPage', 'scheme is optional — members paste bare hosts');
assert.equal(id('https://facebook.com/100064321987654'), '100064321987654', 'bare numeric is attempted');

// personal profiles: parsed, flagged, never fetched
assert.equal(node('https://facebook.com/profile.php?id=100012345678901').profile, true);
assert.equal(node('https://facebook.com/profile.php?id=100012345678901').id, '100012345678901');
assert.equal(node('https://www.facebook.com/people/Some-One/61551234567890/').profile, true);
assert.equal(node('https://www.facebook.com/people/Some-One/61551234567890/').id, '61551234567890');
assert.ok(!node('https://facebook.com/YMCPage').profile, 'a page is not flagged as a profile');

// not a readable object
for (const u of [
  'https://facebook.com/groups/123456',
  'https://facebook.com/events/123456',
  'https://facebook.com/watch/?v=123',
  'https://facebook.com/reel/123',
  'https://facebook.com/permalink.php?story_fbid=1&id=2',
  'https://instagram.com/someone',
  'https://example.com/facebook.com/x',
  'https://facebook.com/',
  'not a url at all !!',
  '',
  null,
  undefined,
]) assert.equal(node(u), null, `expected null for ${u}`);

console.log('fb.check: all assertions passed');

// ---- fetchMetrics: the delta accumulator, today-bucketing and the Graph error map ----
// Stubbed transport: the network is not the logic under test, the arithmetic is.
const { fetchMetrics, FbError } = require('./fb');
const DAY = 864e5;
const at = (ms) => new Date(ms).toISOString();
const post = (id, ms, shares, reactions, comments) => ({
  id,
  created_time: at(ms),
  // Graph OMITS shares when it is zero — the stub must too, or the check tests fiction
  ...(shares ? { shares: { count: shares } } : {}),
  reactions: { summary: { total_count: reactions } },
  comments: { summary: { total_count: comments } },
});
const real = global.fetch;
const serve = (...bodies) => {
  let i = 0;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => bodies[i++] });
};
const run = async (seen, info, posts) => {
  serve(info, { data: posts });
  return fetchMetrics('YMCPage', seen, null);
};

(async () => {
  const now = Date.now();

  // first sync: nothing seen before, so every post counts in full
  let m = await run(null, { name: 'الصفحة', followers_count: 100 }, [
    post('p1', now, 5, 10, 2),
    post('p2', now - 3 * DAY, 0, 4, 1),
  ]);
  assert.equal(m.followers, 100);
  assert.equal(m.name, 'الصفحة');
  assert.equal(m.posts, 2);
  assert.equal(m.shares, 5);
  assert.equal(m.reactions, 14);
  assert.equal(m.comments, 3);
  assert.equal(m.postsToday, 1, 'only the post created today counts toward posts_today');
  assert.deepEqual(m.seen.p1, [5, 10, 2]);

  // second sync: only the GROWTH on a post already counted, plus the genuinely new post
  m = await run({ p1: [5, 10, 2], p2: [0, 4, 1] }, { name: 'الصفحة', followers_count: 140 }, [
    post('p1', now - DAY, 8, 12, 2),
    post('p2', now - 3 * DAY, 0, 4, 1),
    post('p3', now, 1, 3, 0),
  ]);
  assert.equal(m.posts, 1, 'p1/p2 were already counted — only p3 is new');
  assert.equal(m.shares, 4, '(8-5) on p1 + 1 on p3');
  assert.equal(m.reactions, 5, '(12-10) on p1 + 3 on p3');
  assert.equal(m.comments, 0, 'nothing gained a comment');
  assert.equal(m.postsToday, 1);

  // a counter that goes DOWN (a deleted share, a hidden reaction) never subtracts from the total
  m = await run({ p1: [8, 12, 2] }, { followers_count: 140 }, [post('p1', now - DAY, 3, 1, 0)]);
  assert.equal(m.shares, 0);
  assert.equal(m.reactions, 0);
  assert.equal(m.comments, 0);

  // a withheld follower count is ABSENT, never 0 — a zero would collapse the followers chart
  m = await run(null, { name: 'x' }, []);
  assert.equal(m.followers, null);
  assert.equal(m.postsToday, 0);

  // error map: Graph answers HTTP 200 with an error object
  for (const [code, re, gone] of [
    [190, /انتهت صلاحية رمز فيسبوك/, false],
    [803, /لم يتم العثور على الصفحة/, true],
    [32, /تجاوز حد طلبات فيسبوك/, false],
    [100, /تحقق من الرابط/, false],
  ]) {
    serve({ error: { code, message: 'x' } });
    const e = await fetchMetrics('YMCPage', null, null).then(() => null, (err) => err);
    assert.ok(e instanceof FbError, `code ${code} must reject with an FbError`);
    assert.match(e.message, re, `code ${code}`);
    assert.equal(e.gone, gone, `code ${code} gone flag — only 803 may close an account`);
  }

  global.fetch = real;
  console.log('fb.check: fetchMetrics + error map passed');
})();

// the id lands in a URL path — nothing but a real alias/numeric id may get that far
for (const u of [
  'https://facebook.com/..',
  'https://facebook.com/%2e%2e%2f%2e%2e',
  'https://facebook.com/a b',
  'https://facebook.com/a:b@evil.com',
]) assert.equal(node(u), null, `expected null for ${u}`);
assert.equal(node('https://facebook.com/YMC.News-Page_1')?.id, 'YMC.News-Page_1', 'real aliases still pass');
