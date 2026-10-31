// Tests for the admin page's Worker (admin/worker.js) against a fake GitHub. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, mondayOf, statusOf } from '../admin/worker.js';

const REPO = 'cgrade/intimova-content';
const post = (id, publish_at, over = {}) => ({ id, publish_at, format: 'carousel', platforms: ['instagram', 'facebook', 'tiktok'], series_label: 'MYTH VS FACT',
  slides: [{ type: 'myth', text: 'A *myth*' }], captions: { instagram: 'ig ' + id, tiktok_title: 'tt', tiktok: 'tt ' + id }, ...over });

/** A fake GitHub: files per ref, pull requests, issues; records every call. */
function fakeGithub({ files = {}, pulls = [], issues = [] } = {}) {
  const calls = [];
  const res = (status, body) => new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), { status });
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url); const method = opts.method || 'GET';
    calls.push({ method, url: u.href, body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers });
    if (u.origin !== 'https://api.github.com') return res(200, 'FILEBYTES');
    const p = u.pathname.replace(`/repos/${REPO}`, '');
    const ref = u.searchParams.get('ref');
    let m;
    if ((m = p.match(/^\/contents\/(.+)$/))) {
      const path = decodeURIComponent(m[1]);
      const f = files[ref] || {};
      if (opts.headers.Accept.endsWith('raw')) return f[path] === undefined ? res(404, '{}') : res(200, JSON.stringify(f[path]));
      const kids = [...new Set(Object.keys(f).filter(k => k.startsWith(path + '/')).map(k => k.slice(path.length + 1).split('/')[0]))];
      return kids.length ? res(200, kids.map(name => ({ name, type: 'dir' }))) : res(404, '{}');
    }
    if (p === '/pulls' && method === 'GET') return res(200, pulls);
    if ((m = p.match(/^\/pulls\/(\d+)$/))) return res(200, pulls.find(x => x.number === Number(m[1])) || null);
    if ((m = p.match(/^\/pulls\/(\d+)\/merge$/))) return res(200, { merged: true, message: 'Pull Request successfully merged' });
    if ((m = p.match(/^\/issues\/(\d+)\/comments$/))) return res(201, { html_url: 'https://github.com/c' });
    if (p === '/issues') return res(200, issues);
    if ((m = p.match(/^\/issues\/(\d+)$/))) return method === 'GET' ? res(200, issues.find(i => i.number === Number(m[1]))) : res(200, {});
    return res(404, '{}');
  };
  return { fetchImpl, calls };
}

const env = { GITHUB_TOKEN: 'ghs', GITHUB_REPO: REPO, MEDIA_BASE: 'https://media.intimova.ng', ASSETS: { fetch: async () => new Response('<html>page</html>') } };
const signedIn = (email = 'grade@example.com') => ({ access: { aud: 'x', getIdentity: async () => ({ email }) } });
const req = (path, opts = {}) => new Request('https://admin.intimova.ng' + path, opts);
const post2 = (path, body) => req(path, { method: 'POST', headers: { 'x-intimova-admin': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

test('fails closed: no Access means no page and no data; ALLOWED_EMAILS narrows it; changes need the admin header', async () => {
  const gh = fakeGithub();
  assert.equal((await handle(req('/'), env, {}, gh.fetchImpl)).status, 401);
  assert.equal((await handle(req('/api/week'), env, {}, gh.fetchImpl)).status, 401);
  assert.equal(gh.calls.length, 0);                                   // nothing reached GitHub
  assert.equal((await handle(req('/'), { ...env, ALLOWED_EMAILS: 'grade@example.com' }, signedIn('other@example.com'), gh.fetchImpl)).status, 403);
  assert.equal(await (await handle(req('/'), { ...env, ALLOWED_EMAILS: 'Grade@Example.com' }, signedIn(), gh.fetchImpl)).text(), '<html>page</html>');
  const forged = await handle(req('/api/drafts/5/approve', { method: 'POST', body: '{}' }), env, signedIn(), gh.fetchImpl);
  assert.equal(forged.status, 400);
  assert.equal(gh.calls.length, 0);
});

test('Lagos weeks start on Monday', () => {
  assert.equal(mondayOf(new Date('2026-11-01T22:30:00Z')), '2026-10-26');   // Sunday 23:30 Lagos: still the old week
  assert.equal(mondayOf(new Date('2026-11-01T23:30:00Z')), '2026-11-02');   // Monday 00:30 Lagos: the new week
  assert.equal(mondayOf(new Date('2026-11-04T10:00:00Z')), '2026-11-02');
  assert.equal(mondayOf(new Date('2026-11-04T10:00:00Z'), 1), '2026-11-09');
});

test('status per platform: posted, failed, held, scheduled, missed, TikTok sent', () => {
  const p = { id: 'a', publish_at: '2026-11-02T19:30:00+01:00', platforms: ['instagram', 'facebook', 'tiktok'], hold: false };
  const due = Date.parse(p.publish_at);
  assert.equal(statusOf(p, {}, due - 1000).overall, 'scheduled');
  assert.deepEqual(statusOf(p, { a: { instagram: { done: true }, facebook: { done: true }, tiktok_manual: { notified: true } } }, due + 60e3).overall, 'posted');
  assert.equal(statusOf(p, { a: { instagram: { done: true }, facebook: { gave_up: true } } }, due + 60e3).overall, 'problem');
  assert.equal(statusOf(p, {}, due + 13 * 3600e3).platforms.instagram, 'missed');
  assert.equal(statusOf({ ...p, hold: true }, {}, due + 60e3).overall, 'held');
});

test('Week view, pinned to the week of 2 Nov through its offset', async () => {
  const gh = fakeGithub({ files: { main: {
    'content/2026-11-02/3-wed/post.json': post('2026-11-04-lily-part2', '2026-11-04T19:30:00+01:00', { format: 'reel', series: 'Lily, part 2', slides: undefined, story: { scenes: [{ lines: [{ text: 'The door was *open.*' }] }] } }),
    'public/2026-11-02/3-wed/manifest.json': { type: 'reel', video: 'reel.mp4', cover: 'cover.jpg', duration: 173.85 },
    'content/2026-11-02/1-mon/post.json': post('2026-11-02-myth', '2026-11-02T19:30:00+01:00'),
    'public/2026-11-02/1-mon/manifest.json': { type: 'carousel', images: ['slide-1.jpg', 'slide-2.jpg'] },
    'state/posted.json': { '2026-11-02-myth': { instagram: { done: true }, facebook: { done: true }, tiktok_manual: { notified: true, issue: 9 } } },
  } } });
  const weeksAway = Math.round((Date.parse('2026-11-02T00:00:00Z') - Date.parse(mondayOf(new Date()) + 'T00:00:00Z')) / (7 * 864e5));
  const d = await (await handle(req(`/api/week?offset=${weeksAway}`), env, signedIn(), gh.fetchImpl)).json();
  assert.equal(d.week, '2026-11-02');
  assert.deepEqual(d.posts.map(p => [p.id, p.day, p.time]), [['2026-11-02-myth', 'Mon', '19:30'], ['2026-11-04-lily-part2', 'Wed', '19:30']]);
  const [myth, lily] = d.posts;
  assert.equal(myth.status.overall, 'posted');
  assert.equal(myth.media[1].url, 'https://media.intimova.ng/2026-11-02/1-mon/slide-2.jpg');
  assert.equal(lily.hook, 'The door was open.');                     // emphasis marks stripped, words unchanged
  assert.equal(lily.media[0].poster, 'https://media.intimova.ng/2026-11-02/3-wed/cover.jpg');
  assert.ok(gh.calls.every(c => c.headers.Authorization === 'Bearer ghs'));
});

test('Approve: lists week drafts with previews from the branch, merges only the version seen, and sends change requests to the PR', async () => {
  const pr = { number: 14, title: 'Intimova: week of 9 November', html_url: 'https://github.com/x/pull/14', head: { ref: 'week/2026-11-09', sha: 'abc123' } };
  const other = { number: 15, title: 'Fix', html_url: 'u', head: { ref: 'fix/thing', sha: 'zzz' } };
  const gh = fakeGithub({ pulls: [pr, other], files: { 'week/2026-11-09': {
    'content/2026-11-09/1-mon/post.json': post('2026-11-09-myth', '2026-11-09T19:30:00+01:00'),
    'public/2026-11-09/1-mon/manifest.json': { type: 'carousel', images: ['slide-1.jpg'] } } } });
  const d = await (await handle(req('/api/drafts'), env, signedIn(), gh.fetchImpl)).json();
  assert.deepEqual(d.drafts.map(x => x.number), [14]);               // only week/ branches
  assert.equal(d.drafts[0].posts[0].media[0].url, `https://raw.githubusercontent.com/${REPO}/week/2026-11-09/public/2026-11-09/1-mon/slide-1.jpg`);

  assert.equal((await handle(post2('/api/drafts/14/approve', {}), env, signedIn(), gh.fetchImpl)).status, 400);   // no sha: refused
  assert.equal((await handle(post2('/api/drafts/15/approve', { sha: 'zzz' }), env, signedIn(), gh.fetchImpl)).status, 400); // not a week PR
  const ok = await (await handle(post2('/api/drafts/14/approve', { sha: 'abc123' }), env, signedIn(), gh.fetchImpl)).json();
  assert.equal(ok.merged, true);
  const merge = gh.calls.find(c => c.method === 'PUT');
  assert.ok(merge.url.endsWith('/pulls/14/merge'));
  assert.deepEqual([merge.body.sha, merge.body.merge_method], ['abc123', 'merge']);

  await handle(post2('/api/drafts/14/comment', { post: '2026-11-09-myth', text: 'Softer takeaway, please' }), env, signedIn(), gh.fetchImpl);
  const c = gh.calls.find(x => x.url.endsWith('/issues/14/comments'));
  assert.match(c.body.body, /^\*\*2026-11-09-myth\*\*: Softer takeaway, please/);
  assert.equal((await handle(post2('/api/drafts/14/comment', { text: '  ' }), env, signedIn(), gh.fetchImpl)).status, 400);
});

test('TikTok: open TikTok issues matched to their posts; "posted" closes only TikTok issues', async () => {
  const gh = fakeGithub({
    issues: [{ number: 9, title: 'Post to TikTok: MYTH', html_url: 'i9', created_at: '2026-11-02T18:31:00Z' }, { number: 20, title: 'Held: x did not post', html_url: 'i20', created_at: '2026-11-02T18:00:00Z' }],
    files: { main: {
      'content/2026-11-02/1-mon/post.json': post('2026-11-02-myth', '2026-11-02T19:30:00+01:00'),
      'public/2026-11-02/1-mon/manifest.json': { type: 'carousel', images: ['slide-1.jpg'] },
      'state/posted.json': { '2026-11-02-myth': { tiktok_manual: { notified: true, issue: 9 } } } } } });
  const d = await (await handle(req('/api/tiktok'), env, signedIn(), gh.fetchImpl)).json();
  assert.deepEqual(d.items.map(i => [i.issue, i.post?.id]), [[9, '2026-11-02-myth']]);
  assert.equal(d.items[0].post.tiktok.caption, 'tt 2026-11-02-myth');
  assert.equal((await handle(post2('/api/tiktok/20/done'), env, signedIn(), gh.fetchImpl)).status, 400);
  await handle(post2('/api/tiktok/9/done'), env, signedIn(), gh.fetchImpl);
  const close = gh.calls.find(c => c.method === 'PATCH');
  assert.ok(close.url.endsWith('/issues/9'));
  assert.equal(close.body.state, 'closed');
});

test('downloads stream only our own media files, as attachments', async () => {
  const gh = fakeGithub();
  const bad = await handle(req('/api/file?url=' + encodeURIComponent('https://evil.example/x.jpg')), env, signedIn(), gh.fetchImpl);
  assert.equal(bad.status, 400);
  const good = await handle(req('/api/file?url=' + encodeURIComponent('https://media.intimova.ng/2026-11-02/3-wed/reel.mp4')), env, signedIn(), gh.fetchImpl);
  assert.equal(good.status, 200);
  assert.match(good.headers.get('content-disposition'), /attachment; filename="3-wed-reel.mp4"/);
});
