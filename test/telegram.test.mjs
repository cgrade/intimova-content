// Telegram channel: poster, backfill and check, against the mock API. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { redact, ApiError } from '../publisher/lib/http.mjs';

test('telegram bot tokens in a URL path are redacted', () => {
  const url = 'https://api.telegram.org/bot123456:AAH-x_y/sendPhoto';
  assert.equal(redact(url), 'https://api.telegram.org/bot***/sendPhoto');
  const e = new ApiError('POST ' + redact(url) + ' failed', { url });
  assert.equal(e.url, 'https://api.telegram.org/bot***/sendPhoto');
  assert.ok(!inspect(e).includes('AAH-x_y'));
});

import { validatePost } from '../lib/post.mjs';
import { loadConfig } from '../publisher/lib/config.mjs';

const post = (over = {}) => ({
  id: 'p', format: 'carousel', publish_at: '2026-11-11T19:30:00+01:00', platforms: ['telegram'],
  captions: { instagram: 'ig', facebook: 'fb' }, slides: [{ type: 'quote', quote: 'q' }],
  safety: { explicit: false, clear_faces: false }, ...over });

test('validation accepts telegram and needs the Facebook caption', () => {
  assert.deepEqual(validatePost(post()), []);
  assert.ok(validatePost(post({ captions: { instagram: 'ig' } })).includes('missing captions.facebook (Telegram uses it)'));
});

test('telegram settings come from the environment', () => {
  const c = loadConfig({ BACKFILL: ' a, b ,', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '@chan' });
  assert.deepEqual(c.backfill, ['a', 'b']);
  assert.equal(c.backfillGapMs, 30000);
  assert.deepEqual(c.telegram, { base: 'https://api.telegram.org', token: 't', chatId: '@chan' });
  assert.deepEqual(loadConfig({}).backfill, []);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMock } from './mock-api.mjs';
import { run } from '../publisher/publish.mjs';
import { loadState } from '../publisher/lib/store.mjs';
import { splitCaption } from '../publisher/platforms/telegram.mjs';

const WEEK = '2026-11-09';
function makeRoot(over = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intimova-tg-'));
  const add = (slug, p, manifest, files) => {
    fs.mkdirSync(path.join(root, 'content', WEEK, slug), { recursive: true });
    fs.writeFileSync(path.join(root, 'content', WEEK, slug, 'post.json'), JSON.stringify(p));
    const pub = path.join(root, 'public', WEEK, slug);
    fs.mkdirSync(pub, { recursive: true });
    fs.writeFileSync(path.join(pub, 'manifest.json'), JSON.stringify(manifest));
    for (const [f, bytes] of Object.entries(files)) fs.writeFileSync(path.join(pub, f), Buffer.alloc(bytes, 7));
  };
  const imgs = [1, 2, 3, 4, 5].map(i => `slide-${i}.jpg`);
  add('1-car', post({ id: 'car', publish_at: '2026-11-09T19:30:00+01:00', platforms: ['instagram', 'telegram'], ...over.car }),
    { type: 'carousel', images: imgs }, Object.fromEntries(imgs.map(i => [i, 2000])));
  add('2-single', post({ id: 'single', publish_at: '2026-11-10T19:30:00+01:00', ...over.single }), { type: 'carousel', images: ['slide-1.jpg'] }, { 'slide-1.jpg': 2000 });
  add('3-reel', post({ id: 'reel', format: 'reel', publish_at: '2026-11-11T19:30:00+01:00', slides: undefined, story: { scenes: [{ lines: [{ text: 'a' }] }] }, ...over.reel }),
    { type: 'reel', video: 'reel.mp4', cover: 'cover.jpg', duration: 176 }, { 'reel.mp4': 3 * 1024 * 1024, 'cover.jpg': 1000 });
  add('4-guide', post({ id: 'guide', publish_at: '2026-11-09T19:00:00+01:00', product: { slug: 'rose', price: 25000 }, ...over.guide }),
    { type: 'carousel', images: ['slide-1.jpg', 'slide-2.jpg'] }, { 'slide-1.jpg': 2000, 'slide-2.jpg': 2000 });
  return root;
}
const cfgFor = (root, mock, over = {}) => loadConfig({
  CONTENT_ROOT: root, NOW: '2026-11-11T20:00:00+01:00', MEDIA_BASE_URL: mock.base + '/media', POLL_MS: '5',
  GRAPH_BASE: mock.base + '/graph', RUPLOAD_BASE: mock.base + '/rupload', META_PAGE_ID: 'PAGE1', META_PAGE_TOKEN: 'page-token', IG_USER_ID: 'IG123',
  SHOP_BASE_URL: mock.base + '/shop', TELEGRAM_BASE: mock.base + '/tg', TELEGRAM_BOT_TOKEN: 'tg-token', TELEGRAM_CHAT_ID: '@intimova',
  PLATFORMS: 'instagram,facebook,telegram', BACKFILL_GAP_MS: '0', MAX_LATE_HOURS: '72', ...over });
const quiet = () => {};
const tg = mock => mock.calls.filter(c => c.path.startsWith('/tg/')).map(c => ({ method: c.path.split('/').pop(), ...c.body }));

test('telegram: single slide is one photo, a carousel is one album, a reel is one video, each once', async () => {
  const root = makeRoot();
  const mock = await startMock({ publicDir: path.join(root, 'public'), products: { rose: { price: 25000 } } });
  try {
    await run(cfgFor(root, mock), quiet);
    const calls = tg(mock);
    const photo = calls.find(c => c.method === 'sendPhoto');
    assert.equal(photo.fields.caption, 'fb');
    assert.equal(photo.fields.chat_id, '@intimova');
    assert.deepEqual(photo.files, ['photo']);
    assert.equal(photo.fields.parse_mode, undefined);
    const albums = calls.filter(c => c.method === 'sendMediaGroup');
    const car = albums.find(a => JSON.parse(a.fields.media).length === 5);
    const media = JSON.parse(car.fields.media);
    assert.deepEqual(media.map(m => [m.type, m.media]), [0, 1, 2, 3, 4].map(i => ['photo', `attach://p${i}`]));
    assert.equal(media[0].caption, 'fb');
    assert.ok(media.slice(1).every(m => m.caption === undefined));
    assert.equal(car.files.length, 5);
    const video = calls.find(c => c.method === 'sendVideo');
    assert.equal(video.fields.supports_streaming, 'true');
    assert.equal(video.fields.cover, 'attach://cover');
    assert.deepEqual(video.files.sort(), ['cover', 'video']);
    const state = loadState(root);
    for (const id of ['car', 'single', 'reel', 'guide']) assert.ok(state[id].telegram.done && state[id].telegram.id, id);
    const before = mock.calls.length;
    await run(cfgFor(root, mock), quiet);
    assert.equal(mock.calls.slice(before).filter(c => c.path.startsWith('/tg/')).length, 0);
  } finally { await mock.close(); }
});

test('telegram: no media-host check (files are uploaded), while Instagram waits', async () => {
  const root = makeRoot();
  const mock = await startMock({ publicDir: path.join(root, 'public'), products: { rose: { price: 25000 } } });
  try {
    const r = await run(cfgFor(root, mock, { MEDIA_BASE_URL: mock.base + '/nowhere', ONLY_POST: 'car' }), quiet);
    assert.ok(r.find(x => x.platform === 'telegram').ok);
    assert.ok(r.find(x => x.platform === 'instagram').waiting);
  } finally { await mock.close(); }
});

test('splitCaption keeps captions up to 1024 and splits longer ones', () => {
  const exact = 'a'.repeat(1024);
  assert.deepEqual(splitCaption(exact), { caption: exact, rest: null });
  const two = 'b'.repeat(700) + '\n\n' + 'c'.repeat(700);
  assert.deepEqual(splitCaption(two), { caption: 'b'.repeat(700), rest: two });
  const one = Array.from({ length: 300 }, () => 'word').join(' ');   // 1499 characters, no paragraph break
  const s = splitCaption(one);
  assert.ok(s.caption.length <= 1024);
  assert.match(s.caption, /word…$/);
  assert.equal(s.rest, one);
});

test('telegram: a long caption is followed by the full text as a reply', async () => {
  const long = 'x'.repeat(700) + '\n\n' + 'y'.repeat(700);
  const root = makeRoot({ single: { captions: { instagram: 'ig', facebook: long } } });
  const mock = await startMock({ publicDir: path.join(root, 'public') });
  try {
    await run(cfgFor(root, mock, { ONLY_POST: 'single' }), quiet);
    const calls = tg(mock);
    const photo = calls.find(c => c.method === 'sendPhoto');
    assert.equal(photo.fields.caption, 'x'.repeat(700));
    const msg = calls.find(c => c.method === 'sendMessage');
    assert.equal(msg.text, long);
    assert.equal(msg.chat_id, '@intimova');
    assert.ok(msg.reply_parameters.message_id > 0);
  } finally { await mock.close(); }
});

test('telegram: a refusal is retried and then given up, without the token in the error', async () => {
  const root = makeRoot();
  const mock = await startMock({ publicDir: path.join(root, 'public'), tgReject: true });
  try {
    for (let i = 0; i < 3; i++) await run(cfgFor(root, mock, { ONLY_POST: 'single' }), quiet);
    const s = loadState(root).single.telegram;
    assert.equal(s.attempts, 3);
    assert.equal(s.gave_up, true);
    assert.match(s.error, /bot is not a member/);
    assert.ok(!s.error.includes('tg-token'));
  } finally { await mock.close(); }
});

test('rehearsal skips telegram', async () => {
  const root = makeRoot();
  const mock = await startMock({ publicDir: path.join(root, 'public') });
  try {
    const log = [];
    await run(cfgFor(root, mock, { ONLY_POST: 'single', REHEARSAL: '1', PLATFORMS: 'telegram' }), l => log.push(l));
    assert.equal(tg(mock).length, 0);
    assert.ok(log.some(l => /telegram: skipped in rehearsal/.test(l)));
  } finally { await mock.close(); }
});

// Backfill: posts that never listed telegram, sent to Telegram only.
const noTg = { car: { platforms: ['instagram', 'facebook'] }, single: { platforms: ['instagram', 'facebook'] }, reel: { platforms: ['instagram', 'facebook'] }, guide: { platforms: ['instagram', 'facebook'] } };

test('backfill sends only to telegram, oldest first, silent except the last', async () => {
  const root = makeRoot(noTg);
  const mock = await startMock({ publicDir: path.join(root, 'public'), products: { rose: { price: 25000 } } });
  try {
    const r = await run(cfgFor(root, mock, { BACKFILL: 'reel, guide, single' }), quiet);
    const sends = tg(mock).filter(c => c.method.startsWith('send'));
    assert.deepEqual(sends.map(c => c.method), ['sendMediaGroup', 'sendPhoto', 'sendVideo']); // guide 9 Nov, single 10 Nov, reel 11 Nov
    assert.deepEqual(sends.map(c => c.fields.disable_notification), ['true', 'true', undefined]);
    assert.equal(mock.calls.filter(c => c.path.startsWith('/graph/') || c.path.startsWith('/rupload/')).length, 0);
    const state = loadState(root);
    for (const id of ['reel', 'guide', 'single']) assert.ok(state[id].telegram.done, id);
    assert.equal(state.car, undefined);
    assert.ok(r.every(x => x.ok && x.platform === 'telegram'));
  } finally { await mock.close(); }
});

test('backfill skips ones already sent and names unknown ids', async () => {
  const root = makeRoot(noTg);
  const mock = await startMock({ publicDir: path.join(root, 'public') });
  try {
    await run(cfgFor(root, mock, { BACKFILL: 'single' }), quiet);
    const before = mock.calls.length;
    const r = await run(cfgFor(root, mock, { BACKFILL: 'single,nope' }), quiet);
    assert.equal(mock.calls.slice(before).filter(c => c.path.startsWith('/tg/')).length, 0);
    assert.equal(r.find(x => x.post === 'nope').note, 'no such post');
    assert.ok(r.find(x => x.post === 'single').ok);
  } finally { await mock.close(); }
});

test('backfill holds a product post whose price changed', async () => {
  const root = makeRoot(noTg);
  const mock = await startMock({ publicDir: path.join(root, 'public'), products: { rose: { price: 30000 } } });
  try {
    const r = await run(cfgFor(root, mock, { BACKFILL: 'guide' }), quiet);
    assert.equal(tg(mock).length, 0);
    assert.match(r[0].note, /^held: /);
  } finally { await mock.close(); }
});

test('backfill dry run posts nothing, and rehearsal refuses a backfill', async () => {
  const root = makeRoot(noTg);
  const mock = await startMock({ publicDir: path.join(root, 'public') });
  try {
    const r = await run(cfgFor(root, mock, { BACKFILL: 'single,reel', DRY_RUN: '1' }), quiet);
    assert.equal(tg(mock).length, 0);
    assert.ok(r.every(x => x.dry));
    const r2 = await run(cfgFor(root, mock, { BACKFILL: 'single', REHEARSAL: '1', ONLY_POST: 'single' }), quiet);
    assert.equal(tg(mock).length, 0);
    assert.equal(r2[0].ok, false);
    assert.deepEqual(loadState(root), {});
  } finally { await mock.close(); }
});
