// X via API v2 with an OAuth 2.0 user token (scopes: tweet.read tweet.write users.read media.write offline.access).
// Media: POST /2/media/upload/initialize -> /{id}/append (chunks) -> /{id}/finalize -> GET status.
// Post: POST /2/tweets. X shows up to 4 images per post, so longer carousels continue as replies.
import fs from 'node:fs';
import { request, sleep, ApiError } from '../lib/http.mjs';

const CHUNK = 4 * 1024 * 1024;

export async function xAccessToken(cfg, tokens, log) {
  const t = tokens.x;
  if (!t?.refresh_token) throw new Error('X is not set up: run npm run setup:x');
  if (t.access_token && t.expires_at && Date.now() < t.expires_at - 5 * 60 * 1000) return t.access_token;
  const headers = {};
  const form = { grant_type: 'refresh_token', refresh_token: t.refresh_token };
  if (cfg.x.clientSecret) headers.Authorization = 'Basic ' + Buffer.from(`${cfg.x.clientId}:${cfg.x.clientSecret}`).toString('base64');
  else form.client_id = cfg.x.clientId;
  const r = await request('POST', `${cfg.x.base}/2/oauth2/token`, { form, headers, retries: 0 });
  tokens.x = { ...t, access_token: r.access_token, refresh_token: r.refresh_token || t.refresh_token, expires_at: Date.now() + (r.expires_in || 7200) * 1000 };
  log('    x: refreshed access token');
  return tokens.x.access_token;
}

async function upload(cfg, token, file, mime, category, log) {
  const bytes = fs.readFileSync(file);
  const auth = { Authorization: `Bearer ${token}` };
  const init = await request('POST', `${cfg.x.base}/2/media/upload/initialize`, { headers: auth, json: { media_type: mime, total_bytes: bytes.length, media_category: category } });
  const id = init?.data?.id || init?.id || init?.media_id_string;
  if (!id) throw new ApiError('X upload initialize returned no media id', { body: init });
  for (let i = 0, seg = 0; i < bytes.length; i += CHUNK, seg++) {
    const fd = new FormData();
    fd.append('segment_index', String(seg));
    fd.append('media', new Blob([bytes.subarray(i, i + CHUNK)], { type: mime }), 'chunk');
    await request('POST', `${cfg.x.base}/2/media/upload/${id}/append`, { headers: auth, body: fd });
  }
  const fin = await request('POST', `${cfg.x.base}/2/media/upload/${id}/finalize`, { headers: auth });
  let info = (fin.data || fin).processing_info;
  for (let polls = 0; info && info.state !== 'succeeded'; polls++) {
    if (info.state === 'failed') throw new ApiError('X media processing failed', { body: info });
    if (polls > 60) throw new ApiError('X media processing took too long');
    await sleep(cfg.pollMs < 1000 ? cfg.pollMs : (info.check_after_secs || 3) * 1000);
    const st = await request('GET', `${cfg.x.base}/2/media/upload?command=STATUS&media_id=${id}`, { headers: auth });
    info = (st.data || st).processing_info;
    if (polls % 5 === 0) log(`    x: media ${id} ${info?.state || 'done'}`);
  }
  return id;
}

export async function postX({ post, manifest, local, cfg, tokens, log }) {
  const token = await xAccessToken(cfg, tokens, log);
  const auth = { Authorization: `Bearer ${token}` };
  const groups = [];
  if (manifest.type === 'reel') groups.push([await upload(cfg, token, local(manifest.video), 'video/mp4', 'tweet_video', log)]);
  else {
    const ids = [];
    for (const img of manifest.images) ids.push(await upload(cfg, token, local(img), 'image/jpeg', 'tweet_image', log));
    for (let i = 0; i < ids.length; i += 4) groups.push(ids.slice(i, i + 4));
  }
  const texts = [post.captions.x, ...(post.captions.x_thread || [])];
  const posted = [];
  const n = Math.max(groups.length, texts.length);
  for (let i = 0; i < n; i++) {
    const body = { text: texts[i] ?? `(${i + 1}/${n})` };
    if (groups[i]) body.media = { media_ids: groups[i] };
    if (posted.length) body.reply = { in_reply_to_tweet_id: posted[posted.length - 1] };
    const r = await request('POST', `${cfg.x.base}/2/tweets`, { headers: auth, json: body, retries: 0 });
    posted.push(r.data.id);
  }
  return { id: posted[0], thread: posted };
}
