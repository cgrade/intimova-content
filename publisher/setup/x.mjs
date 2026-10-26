// One-time X login (OAuth 2.0 with PKCE). Saves a refresh token so the publisher can post for you.
//
// In the X developer console: User authentication settings > OAuth 2.0 on, type "Web App" (confidential),
// permissions Read and write, callback URL e.g. https://intimova.ng/oauth/x (the page can be blank).
// export X_CLIENT_ID=... X_CLIENT_SECRET=... X_REDIRECT_URI=https://intimova.ng/oauth/x TOKENS_KEY=...
// npm run setup:x
import crypto from 'node:crypto';
import { need, ask, codeFrom, mergeTokens } from './common.mjs';
import { request } from '../lib/http.mjs';

const env = need(['X_CLIENT_ID', 'X_CLIENT_SECRET', 'X_REDIRECT_URI', 'TOKENS_KEY']);
const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const verifier = b64url(crypto.randomBytes(32));
const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
const state = b64url(crypto.randomBytes(12));
const auth = new URL('https://x.com/i/oauth2/authorize');
auth.search = new URLSearchParams({ response_type: 'code', client_id: env.X_CLIENT_ID, redirect_uri: env.X_REDIRECT_URI,
  scope: 'tweet.read tweet.write users.read media.write offline.access', state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();

console.log('1. Open this link while logged in to the Intimova X account, and approve:\n\n' + auth + '\n');
const pasted = await ask('2. Paste the full address you land on (it starts with your callback URL): ');
const code = codeFrom(pasted, state);
const r = await request('POST', `${process.env.X_BASE || 'https://api.x.com'}/2/oauth2/token`, {
  headers: { Authorization: 'Basic ' + Buffer.from(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`).toString('base64') },
  form: { code, grant_type: 'authorization_code', redirect_uri: env.X_REDIRECT_URI, code_verifier: verifier }, retries: 0 });
if (!r.refresh_token) { console.error('No refresh token came back. Check offline.access is allowed for the app.'); process.exit(1); }
console.log('✓ X connected. Scopes: ' + (r.scope || '(not reported)'));
mergeTokens({ x: { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: Date.now() + (r.expires_in || 7200) * 1000 } });
console.log('Also add GitHub secrets X_CLIENT_ID and X_CLIENT_SECRET.');
