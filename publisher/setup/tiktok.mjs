// One-time TikTok login (Login Kit, web). Saves a refresh token so the publisher can send drafts to your inbox.
//
// In developers.tiktok.com: your app > Login Kit redirect URI e.g. https://intimova.ng/oauth/tiktok (must be https),
// Content Posting API with the video.upload scope, and media.intimova.ng verified as your URL prefix.
// export TIKTOK_CLIENT_KEY=... TIKTOK_CLIENT_SECRET=... TIKTOK_REDIRECT_URI=https://intimova.ng/oauth/tiktok TOKENS_KEY=...
// npm run setup:tiktok
import crypto from 'node:crypto';
import { need, ask, codeFrom, mergeTokens } from './common.mjs';
import { request } from '../lib/http.mjs';

const env = need(['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI', 'TOKENS_KEY']);
const state = crypto.randomBytes(12).toString('hex');
const auth = new URL('https://www.tiktok.com/v2/auth/authorize/');
auth.search = new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, response_type: 'code', scope: 'video.upload', redirect_uri: env.TIKTOK_REDIRECT_URI, state }).toString();

console.log('1. Open this link while logged in to the Intimova TikTok account, and approve:\n\n' + auth + '\n');
const pasted = await ask('2. Paste the full address you land on: ');
const code = codeFrom(pasted, state);
const r = await request('POST', `${process.env.TIKTOK_BASE || 'https://open.tiktokapis.com'}/v2/oauth/token/`, { retries: 0,
  form: { client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: env.TIKTOK_REDIRECT_URI } });
if (!r.refresh_token) { console.error('TikTok did not return a refresh token: ' + JSON.stringify(r)); process.exit(1); }
console.log(`✓ TikTok connected (${r.scope}). TikTok's refresh token lasts 365 days; the publisher warns you 30 days before, and you rerun this script then.`);
mergeTokens({ tiktok: { access_token: r.access_token, refresh_token: r.refresh_token, open_id: r.open_id,
  expires_at: Date.now() + (r.expires_in || 86400) * 1000, refresh_expires_at: Date.now() + (r.refresh_expires_in || 31536000) * 1000 } });
console.log('Also add GitHub secrets TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET.');
