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
