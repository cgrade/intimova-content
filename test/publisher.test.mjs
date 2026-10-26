// End-to-end test of the publisher against the mock API. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { startMock } from './mock-api.mjs';
import { run } from '../publisher/publish.mjs';
import { loadConfig } from '../publisher/lib/config.mjs';
import { saveTokens, loadTokens, loadState } from '../publisher/lib/store.mjs';
import { validatePost } from '../lib/post.mjs';

const KEY = crypto.randomBytes(32).toString('base64');
const base = (over = {}) => ({
  id: 'p', format: 'carousel', publish_at: '2026-11-02T19:30:00+01:00', platforms: ['instagram', 'facebook', 'x', 'tiktok'],
  captions: { instagram: 'ig', facebook: 'fb', x: 'x post', x_thread: ['more'], tiktok_title: 'tt', tiktok: 'tt desc' },
  safety: { explicit: false, clear_faces: false }, ...over });

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intimova-'));
  const week = '2026-11-02';
  const add = (slug, post, manifest, files) => {
    fs.mkdirSync(path.join(root, 'content', week, slug), { recursive: true });
    fs.writeFileSync(path.join(root, 'content', week, slug, 'post.json'), JSON.stringify(post));
    const pub = path.join(root, 'public', week, slug);
    fs.mkdirSync(pub, { recursive: true });
    if (manifest) fs.writeFileSync(path.join(pub, 'manifest.json'), JSON.stringify(manifest));
    for (const [f, bytes] of Object.entries(files)) fs.writeFileSync(path.join(pub, f), Buffer.alloc(bytes, 7));
  };
  const imgs = ['slide-1.jpg', 'slide-2.jpg', 'slide-3.jpg', 'slide-4.jpg', 'slide-5.jpg'];
  add('1-carousel', base({ id: 'car', slides: [{ type: 'quote', quote: 'q' }] }), { type: 'carousel', images: imgs }, Object.fromEntries(imgs.map(i => [i, 2000])));
  add('2-reel', base({ id: 'reel', format: 'reel', publish_at: '2026-11-02T20:00:00+01:00', story: { scenes: [{ lines: [{ text: 'a' }] }] } }),
    { type: 'reel', video: 'reel.mp4', cover: 'cover.jpg', duration: 89.2 }, { 'reel.mp4': 9 * 1024 * 1024, 'cover.jpg': 1000 });
  add('3-single', base({ id: 'single', slides: [{ type: 'quote', quote: 'q' }], captions: { ...base().captions, x_thread: [] } }), { type: 'carousel', images: ['slide-1.jpg'] }, { 'slide-1.jpg': 2000 });
  add('4-held', base({ id: 'held', hold: true, slides: [{ type: 'quote', quote: 'q' }] }), { type: 'carousel', images: ['slide-1.jpg'] }, { 'slide-1.jpg': 2000 });
  add('5-unrendered', base({ id: 'norender', publish_at: '2026-11-02T20:15:00+01:00', slides: [{ type: 'quote', quote: 'q' }] }), null, {});
  saveTokens(root, { x: { refresh_token: 'x-refresh-1' }, tiktok: { refresh_token: 'tt-refresh-1' } }, KEY);
  return root;
}

function cfgFor(root, mock, over = {}) {
  return loadConfig({
    CONTENT_ROOT: root, NOW: '2026-11-02T20:30:00+01:00', MEDIA_BASE_URL: mock.base + '/media', POLL_MS: '5',
    GRAPH_BASE: mock.base + '/graph', RUPLOAD_BASE: mock.base + '/rupload', X_BASE: mock.base + '/x', TIKTOK_BASE: mock.base + '/tiktok',
    META_PAGE_ID: 'PAGE1', META_PAGE_TOKEN: 'page-token', IG_USER_ID: 'IG123',
    X_CLIENT_ID: 'xid', X_CLIENT_SECRET: 'xsecret', TIKTOK_CLIENT_KEY: 'tkey', TIKTOK_CLIENT_SECRET: 'tsecret', TOKENS_KEY: KEY,
    PLATFORMS: 'instagram,facebook,x,tiktok', ...over });
}
const quiet = () => {};

test('TikTok by hand: one GitHub issue per post with links and caption, never twice', async () => {
  const root = makeRoot();
  const mock = await startMock({ publicDir: path.join(root, 'public') });
  try {
    const gh = { PLATFORMS: 'instagram,facebook', GITHUB_API_URL: mock.base + '/gh', GITHUB_TOKEN: 'ghs_test', GITHUB_REPOSITORY: 'cgrade/intimova-content', NOTIFY_USER: 'cgrade' };
    const r = await run(cfgFor(root, mock, gh), quiet);
    const manual = r.filter(x => x.platform === 'tiktok (by hand)');
    assert.equal(manual.length, 3);                                   // carousel, reel, single
    assert.ok(manual.every(x => x.ok && /issue #\d+/.test(x.id)));
    assert.equal(mock.calls.filter(c => c.path.startsWith('/tiktok') || c.path.startsWith('/x')).length, 0); // no TikTok or X API calls
    const issues = mock.calls.filter(c => c.path === '/gh/repos/cgrade/intimova-content/issues');
    assert.equal(issues.length, 3);
    const reel = issues.find(i => /reel\.mp4/.test(i.body.body));
    assert.match(reel.body.body, /^@cgrade it's time to post this on TikTok/);
    assert.match(reel.body.body, /\/media\/2026-11-02\/2-reel\/reel\.mp4\)/);
    assert.match(reel.body.body, /tt desc/);                          // the TikTok caption
    assert.doesNotMatch(reel.body.body, /\*\*Title\*\*/);              // reels have no title field
    const car = issues.find(i => /Slide 5/.test(i.body.body));
    assert.match(car.body.body, /\*\*Title\*\*\n```\ntt\n```/);
    assert.equal(issues[0].headers.authorization, 'Bearer ghs_test');
    assert.ok(loadState(root).car.tiktok_manual.notified);
    const again = await run(cfgFor(root, mock, gh), quiet);
    assert.equal(again.filter(x => x.platform === 'tiktok (by hand)').length, 0);
    assert.equal(mock.calls.filter(c => c.path.endsWith('/issues')).length, 3);
  } finally { await mock.close(); }
});

test('publishes carousel, single image and reel to all four platforms, once', async () => {
  const root = makeRoot();
  const publicDir = path.join(root, 'public');
  const mock = await startMock({ publicDir });
  try {
    const results = await run(cfgFor(root, mock), quiet);
    const ok = results.filter(r => r.ok);
    assert.equal(ok.length, 12, JSON.stringify(results, null, 1));          // 3 posts × 4 platforms
    assert.ok(results.some(r => r.post === 'norender' && !r.ok));            // unrendered post is reported, not posted
    assert.ok(!results.some(r => r.post === 'held'));                        // held post is skipped
    const c = mock.calls;
    // Instagram carousel: 5 item containers, 1 carousel container, publish
    const igItems = c.filter(x => x.path === '/graph/v26.0/IG123/media' && x.body.is_carousel_item === 'true');
    assert.equal(igItems.length, 5);
    const igCar = c.find(x => x.path === '/graph/v26.0/IG123/media' && x.body.media_type === 'CAROUSEL');
    assert.equal(igCar.body.children.split(',').length, 5);
    assert.equal(igCar.body.caption, 'ig');
    const igReel = c.find(x => x.body.media_type === 'REELS');
    assert.match(igReel.body.video_url, /\/media\/2026-11-02\/2-reel\/reel\.mp4$/);
    assert.match(igReel.body.cover_url, /cover\.jpg$/);
    assert.equal(c.filter(x => x.path === '/graph/v26.0/IG123/media_publish').length, 3);
    // Facebook: unpublished photos then one feed post with attached_media
    const feed = c.find(x => x.path === '/graph/v26.0/PAGE1/feed');
    assert.equal(Object.keys(feed.body).filter(k => k.startsWith('attached_media')).length, 5);
    assert.deepEqual(JSON.parse(feed.body['attached_media[0]']).media_fbid.startsWith('ph'), true);
    const rup = c.find(x => x.path.startsWith('/rupload/'));
    assert.match(rup.headers.file_url, /reel\.mp4$/);
    const fin = c.find(x => x.path === '/graph/v26.0/PAGE1/video_reels' && x.body.upload_phase === 'finish');
    assert.equal(fin.body.video_state, 'PUBLISHED');
    // X: refreshed token, 5 images split 4 + 1 into a thread, reel video in 3 chunks
    assert.equal(c.filter(x => x.path === '/x/2/oauth2/token').length, 1);
    const tweets = c.filter(x => x.path === '/x/2/tweets');
    assert.equal(tweets.length, 5); // carousel thread (2) + reel with its follow-up (2) + single (1)
    const carThread = tweets.filter(t => t.body.text === 'x post' || t.body.text === 'more');
    assert.ok(carThread.some(t => t.body.media?.media_ids.length === 4));
    assert.ok(tweets.some(t => t.body.reply?.in_reply_to_tweet_id));
    const appends = c.filter(x => /\/append$/.test(x.path));
    assert.ok(appends.length >= 5 + 3 + 1);
    assert.ok(tweets.every(t => t.headers.authorization === 'Bearer x-access-2'));
    // TikTok: photo drafts with verified-domain URLs and a video draft
    const ttPhoto = c.find(x => x.path === '/tiktok/v2/post/publish/content/init/' && x.body.source_info.photo_images.length === 5);
    assert.equal(ttPhoto.body.post_mode, 'MEDIA_UPLOAD');
    assert.equal(ttPhoto.body.media_type, 'PHOTO');
    assert.ok(c.find(x => x.path === '/tiktok/v2/post/publish/inbox/video/init/').body.source_info.video_url.endsWith('reel.mp4'));
    // Rotated tokens were saved, encrypted
    const t = loadTokens(root, KEY);
    assert.equal(t.x.refresh_token, 'x-refresh-2');
    assert.equal(t.tiktok.refresh_token, 'tt-refresh-2');
    assert.ok(!fs.readFileSync(path.join(root, 'state', 'tokens.enc'), 'utf8').includes('refresh'));
    // Second run posts nothing new
    const before = mock.calls.length;
    const again = await run(cfgFor(root, mock), quiet);
    assert.equal(again.filter(r => r.ok).length, 0);
    assert.equal(mock.calls.filter((x, i) => i >= before && x.method === 'POST').length, 0);
  } finally { await mock.close(); }
});

test('a failed platform is retried next run without reposting the others', async () => {
  const root = makeRoot();
  const mock = await startMock({ publicDir: path.join(root, 'public'), failOnce: { 'POST /x/2/tweets': 2 } });
  try {
    const cfg = cfgFor(root, mock, { NOW: '2026-11-02T19:45:00+01:00' }); // only the carousel and single are due
    const r1 = await run(cfg, quiet);
    assert.ok(r1.some(r => r.platform === 'x' && !r.ok));
    const s1 = loadState(root);
    assert.equal(s1.car.x.attempts, 1);
    assert.ok(s1.car.instagram.done);
    const igPublishes = mock.calls.filter(x => x.path.endsWith('/media_publish')).length;
    const r2 = await run(cfg, quiet);
    assert.ok(r2.filter(r => r.platform === 'x').every(r => r.ok));
    assert.equal(mock.calls.filter(x => x.path.endsWith('/media_publish')).length, igPublishes); // Instagram not reposted
  } finally { await mock.close(); }
});

test('waits when media is not live yet, and dry run posts nothing', async () => {
  const root = makeRoot();
  const mock = await startMock({ publicDir: path.join(root, 'public') });
  try {
    const r = await run(cfgFor(root, mock, { MEDIA_BASE_URL: mock.base + '/media/missing', NOW: '2026-11-02T19:45:00+01:00', PLATFORMS: 'instagram' }), quiet);
    assert.ok(r.every(x => x.waiting));
    assert.equal(loadState(root).car?.instagram?.attempts ?? 0, 0);
    const d = await run(cfgFor(root, mock, { DRY_RUN: '1' }), quiet);
    assert.ok(d.filter(x => x.ok).every(x => x.dry));
    assert.equal(mock.calls.filter(x => x.method === 'POST').length, 0);
  } finally { await mock.close(); }
});

test('validation catches long X posts and missing safety checks', () => {
  const p = base({ slides: [{ type: 'quote', quote: 'q' }] });
  p.captions.x = 'a'.repeat(281);
  delete p.safety.explicit;
  const e = validatePost(p);
  assert.ok(e.some(m => m.includes('X post 1')));
  assert.ok(e.some(m => m.includes('safety.explicit')));
});
