// One-time Meta setup: turns a short-lived user token into a long-lived Page token, finds the
// Instagram account linked to the Page, and checks the Page token can read that Instagram account.
//
// 1. In developers.facebook.com > Tools > Graph API Explorer, pick your app, then "Get User Access Token" with:
//    pages_show_list, pages_read_engagement, pages_manage_posts, pages_manage_engagement,
//    pages_read_user_engagement, instagram_basic, instagram_content_publish
//    (add business_management if your Page sits in a Meta Business portfolio).
// 2. export META_APP_ID=... META_APP_SECRET=... META_SHORT_TOKEN=<the token you just generated>
// 3. npm run setup:meta
import { need, ask } from './common.mjs';
import { request } from '../lib/http.mjs';

const env = need(['META_APP_ID', 'META_APP_SECRET', 'META_SHORT_TOKEN']);
const api = `${process.env.GRAPH_BASE || 'https://graph.facebook.com'}/${process.env.GRAPH_VERSION || 'v26.0'}`;
const q = o => new URLSearchParams(o).toString();

const ll = await request('GET', `${api}/oauth/access_token?${q({ grant_type: 'fb_exchange_token', client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, fb_exchange_token: env.META_SHORT_TOKEN })}`);
console.log('✓ Got a long-lived user token (lasts about 60 days).');
const pages = (await request('GET', `${api}/me/accounts?${q({ fields: 'id,name,access_token', access_token: ll.access_token })}`)).data || [];
if (!pages.length) { console.error('No Pages found. Check you approved pages_show_list and that you manage the Page.'); process.exit(1); }
pages.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} (${p.id})`));
const pick = pages.length === 1 ? 0 : Number(await ask('Which Page is Intimova? Number: ')) - 1;
const page = pages[pick];
const ig = await request('GET', `${api}/${page.id}?${q({ fields: 'instagram_business_account', access_token: page.access_token })}`);
const igId = ig.instagram_business_account?.id;
if (!igId) { console.error('This Page has no linked Instagram professional account. Link it in Instagram settings, then run again.'); process.exit(1); }

let pageTokenWorksForIg = true;
try {
  const me = await request('GET', `${api}/${igId}?${q({ fields: 'username', access_token: page.access_token })}`);
  console.log(`✓ Page token can read Instagram @${me.username}`);
} catch (e) { pageTokenWorksForIg = false; console.log('✗ Page token was refused for Instagram: ' + e.message); }

console.log(`
Add these as GitHub secrets (Settings > Secrets and variables > Actions):
  META_PAGE_ID     = ${page.id}
  IG_USER_ID       = ${igId}
  META_PAGE_TOKEN  = ${page.access_token}
${pageTokenWorksForIg ? '' : `  META_IG_TOKEN    = ${ll.access_token}
  (This user token expires in about 60 days. Tell Claude, and we'll switch Instagram to a token that renews itself.)
`}Long-lived Page tokens have no fixed expiry, but changing your Facebook password or removing the app ends them.`);
