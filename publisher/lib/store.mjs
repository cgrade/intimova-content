// state/posted.json records what went out where, so nothing posts twice.
// state/tokens.enc holds the X and TikTok tokens, which change on refresh. It is AES-256-GCM
// encrypted with TOKENS_KEY (a GitHub secret), so the file is safe to commit.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function loadState(root) {
  const f = path.join(root, 'state', 'posted.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}
export function saveState(root, state) {
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, 'state', 'posted.json'), JSON.stringify(state, null, 2) + '\n');
}

function keyFrom(b64) {
  const k = Buffer.from(b64 || '', 'base64');
  if (k.length !== 32) throw new Error('TOKENS_KEY must be 32 random bytes, base64-encoded. Run: npm run setup:key');
  return k;
}
export function encrypt(obj, b64key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFrom(b64key), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }) + '\n';
}
export function decrypt(text, b64key) {
  const { iv, tag, data } = JSON.parse(text);
  const d = crypto.createDecipheriv('aes-256-gcm', keyFrom(b64key), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8'));
}
export function loadTokens(root, b64key) {
  const f = path.join(root, 'state', 'tokens.enc');
  if (!fs.existsSync(f)) return {};
  return decrypt(fs.readFileSync(f, 'utf8'), b64key);
}
export function saveTokens(root, tokens, b64key) {
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, 'state', 'tokens.enc'), encrypt(tokens, b64key));
}
