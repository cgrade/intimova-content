// Tests for the alerts and the watchdog (publisher/watch.mjs). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMock } from './mock-api.mjs';
import { postAlerts, watchdogAlerts, raiseAlerts, nextMonday, lagos } from '../publisher/watch.mjs';
import { loadConfig } from '../publisher/lib/config.mjs';

const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'intimova-watch-'));
const cfgAt = (now, mock, over = {}) => loadConfig({ CONTENT_ROOT: over.root || root(), NOW: now, GITHUB_API_URL: mock ? mock.base + '/gh' : '',
  GITHUB_TOKEN: 'ghs_test', GITHUB_REPOSITORY: 'cgrade/intimova-content', NOTIFY_USER: 'cgrade', ...over.env });
const post = (id, publish_at, over = {}) => ({ id, publish_at, platforms: ['instagram', 'facebook', 'tiktok'], _week: '2026-11-02', ...over });

test('Lagos time and the next Monday', () => {
  assert.deepEqual(lagos(new Date('2026-10-31T13:00:00Z')), { day: 6, hour: 14, minute: 0, date: '2026-10-31' });
  assert.equal(nextMonday(new Date('2026-10-31T13:00:00Z')), '2026-11-02');   // Saturday
  assert.equal(nextMonday(new Date('2026-11-01T22:30:00Z')), '2026-11-02');   // Sunday 23:30 Lagos
});

test('post alerts: held, broken, given up and missed; nothing for posts that went out or are on hold', () => {
  const cfg = cfgAt('2026-11-03T12:00:00+01:00');
  const results = [
    { post: 'guide', platform: '-', ok: false, note: 'held: The Bullet costs ₦18,000 on the shop, but the post says ₦15,000' },
    { post: 'bad', platform: '-', ok: false, note: 'not rendered yet (no manifest.json in public/)' },
    { post: 'wait', platform: '-', ok: false, waiting: true, note: 'shop not reachable' }];
  const state = { reel: { instagram: { done: true }, facebook: { gave_up: true, attempts: 3, error: 'Restricted by robots.txt' } },
    sent: { instagram: { done: true }, facebook: { done: true } } };
  const posts = [post('missed', '2026-11-02T19:30:00+01:00'), post('sent', '2026-11-02T19:30:00+01:00'),
    post('shelved', '2026-11-02T19:30:00+01:00', { hold: true }), post('ancient', '2026-10-01T19:30:00+01:00'),
    post('soon', '2026-11-03T19:30:00+01:00')];
  const keys = postAlerts({ results, posts, state, cfg }).map(a => a.key).sort();
  assert.deepEqual(keys, ['broken:bad', 'failed:reel:facebook', 'held:guide', 'missed:missed']);
});

test('the alarm watchdog runs only on GitHub\'s own schedule, from 09:00, and alerts after 2 quiet hours', async () => {
  const quiet = await startMock({ publicDir: root(), ghRuns: [{ created_at: '2026-11-03T07:01:00Z' }] });   // 08:01 Lagos
  const busy = await startMock({ publicDir: root(), ghRuns: [{ created_at: '2026-11-03T09:51:00Z' }] });    // 10:51 Lagos
  try {
    const sched = { env: { GITHUB_EVENT_NAME: 'schedule' } };
    const at11 = '2026-11-03T11:03:00+01:00';
    assert.deepEqual((await watchdogAlerts(cfgAt(at11, quiet, sched))).map(a => a.key), ['alarm:2026-11-03']);
    assert.deepEqual(await watchdogAlerts(cfgAt(at11, busy, sched)), []);
    assert.deepEqual(await watchdogAlerts(cfgAt('2026-11-03T08:03:00+01:00', quiet, sched)), []);              // before 09:00: the overnight gap is normal
    assert.deepEqual(await watchdogAlerts(cfgAt(at11, quiet, { env: { GITHUB_EVENT_NAME: 'workflow_dispatch' } })), []); // the alarm's own runs never check
  } finally { await quiet.close(); await busy.close(); }
});

test('the week watchdog: no draft by Saturday 13:00, and not merged by Sunday 20:00', async () => {
  const none = await startMock({ publicDir: root() });
  const open = await startMock({ publicDir: root(), ghPulls: [{ number: 12, head: 'week/2026-11-09', html_url: 'https://github.com/cgrade/intimova-content/pull/12' }] });
  try {
    assert.deepEqual(await watchdogAlerts(cfgAt('2026-11-07T12:30:00+01:00', none)), []);                       // Saturday morning: too early
    assert.deepEqual((await watchdogAlerts(cfgAt('2026-11-07T13:30:00+01:00', none))).map(a => a.key), ['draft:2026-11-09']);
    assert.deepEqual(await watchdogAlerts(cfgAt('2026-11-07T13:30:00+01:00', open)), []);                       // drafted, approval not due yet
    const sun = await watchdogAlerts(cfgAt('2026-11-08T20:30:00+01:00', open));
    assert.deepEqual(sun.map(a => a.key), ['approve:2026-11-09']);
    assert.match(sun[0].body.join('\n'), /pull\/12/);
    const merged = root(); fs.mkdirSync(path.join(merged, 'content', '2026-11-09'), { recursive: true });
    assert.deepEqual(await watchdogAlerts(cfgAt('2026-11-08T20:30:00+01:00', none, { root: merged })), []);    // on main: all good
    assert.deepEqual(await watchdogAlerts(cfgAt('2026-11-04T20:30:00+01:00', none)), []);                       // a weekday: nothing to check
  } finally { await none.close(); await open.close(); }
});

test('each alert opens one issue that tags Grade, and is never raised twice', async () => {
  const dir = root();
  const mock = await startMock({ publicDir: dir });
  try {
    const cfg = cfgAt('2026-11-03T12:00:00+01:00', mock, { root: dir });
    const a = [{ key: 'held:guide', title: 'Held: guide did not post', body: ['The publisher held **guide**.', '', 'Fix it.'] }];
    assert.equal((await raiseAlerts(cfg, a, () => {})).length, 1);
    assert.equal((await raiseAlerts(cfg, a, () => {})).length, 0);
    const issues = mock.calls.filter(c => c.path.endsWith('/issues'));
    assert.equal(issues.length, 1);
    assert.match(issues[0].body.body, /^@cgrade The publisher held \*\*guide\*\*/);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'alerts.json'), 'utf8'))['held:guide'];
    assert.ok(Number.isInteger(saved.issue) && saved.at === '2026-11-03T11:00:00.000Z');   // remembered, so it's never raised again
  } finally { await mock.close(); }
});
