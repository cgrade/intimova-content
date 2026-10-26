// TikTok Content Posting API, "upload to inbox" mode (scope video.upload).
// TikTok only allows apps it hasn't audited to post privately, so we send drafts to your inbox;
// you open the notification, add a sound and post. Media URLs must be on a domain verified with TikTok.
import { request, sleep, ApiError } from '../lib/http.mjs';

export async function tiktokAccessToken(cfg, tokens, log) {
  const t = tokens.tiktok;
  if (!t?.refresh_token) throw new Error('TikTok is not set up: run npm run setup:tiktok');
  if (t.access_token && t.expires_at && Date.now() < t.expires_at - 10 * 60 * 1000) return t.access_token;
  const r = await request('POST', `${cfg.tiktok.base}/v2/oauth/token/`, { retries: 0, form: {
    client_key: cfg.tiktok.clientKey, client_secret: cfg.tiktok.clientSecret, grant_type: 'refresh_token', refresh_token: t.refresh_token } });
  if (!r.access_token) throw new ApiError('TikTok token refresh failed', { body: r });
  // TikTok may return a different refresh token; always keep the newest one.
  tokens.tiktok = { ...t, access_token: r.access_token, refresh_token: r.refresh_token || t.refresh_token,
    expires_at: Date.now() + (r.expires_in || 86400) * 1000,
    refresh_expires_at: r.refresh_expires_in ? Date.now() + r.refresh_expires_in * 1000 : t.refresh_expires_at };
  log('    tiktok: refreshed access token');
  return tokens.tiktok.access_token;
}

function check(r, what) {
  if (r?.error && r.error.code && r.error.code !== 'ok') throw new ApiError(`TikTok ${what}: ${r.error.code} ${r.error.message || ''}`, { body: r });
  return r;
}

export async function postTiktok({ post, manifest, url, cfg, tokens, log }) {
  const token = await tiktokAccessToken(cfg, tokens, log);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' };
  let r;
  if (manifest.type === 'reel') {
    r = check(await request('POST', `${cfg.tiktok.base}/v2/post/publish/inbox/video/init/`, { headers, retries: 0,
      json: { source_info: { source: 'PULL_FROM_URL', video_url: url(manifest.video) } } }), 'video upload');
  } else {
    r = check(await request('POST', `${cfg.tiktok.base}/v2/post/publish/content/init/`, { headers, retries: 0, json: {
      post_info: { title: post.captions.tiktok_title || '', description: post.captions.tiktok || '' },
      source_info: { source: 'PULL_FROM_URL', photo_images: manifest.images.slice(0, 35).map(url), photo_cover_index: 0 },
      post_mode: 'MEDIA_UPLOAD', media_type: 'PHOTO', is_aigc: !!post.ai_generated } }), 'photo upload');
  }
  const publishId = r.data.publish_id;
  // Check that the draft reached the inbox (or failed) before reporting back.
  let status = 'PROCESSING_DOWNLOAD';
  for (let i = 0; i < 18 && status === 'PROCESSING_DOWNLOAD'; i++) {
    await sleep(cfg.pollMs);
    const s = check(await request('POST', `${cfg.tiktok.base}/v2/post/publish/status/fetch/`, { headers, json: { publish_id: publishId } }), 'status');
    status = s.data?.status || status;
    if (status === 'FAILED') throw new ApiError(`TikTok could not take the draft: ${s.data?.fail_reason || 'unknown reason'}`, { body: s });
  }
  log(`    tiktok: ${status}`);
  return { id: publishId, status, needs_caption: manifest.type === 'reel' };
}
