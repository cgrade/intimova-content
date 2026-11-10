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
