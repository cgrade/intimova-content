// Facebook Page via the Graph API.
// Photos: /{page}/photos (published=false for each) -> /{page}/feed with attached_media.
// Reel: /{page}/video_reels start -> rupload with the file's bytes -> finish with video_state=PUBLISHED.
// The reel is sent as bytes, not as a file_url, because Facebook refuses URLs on sites whose robots.txt
// blocks any Meta crawler, and Cloudflare's managed robots.txt for intimova.ng blocks meta-externalagent.
// Video over 90 s: Facebook Reels stop at 90 s, so it goes out as a Page video instead, /{page}/videos with the
// file attached as "source" on graph-video.facebook.com.
// Rehearsal (cfg.rehearsal): uploads, but publishes nothing (unpublished photos and video, no reel finish, no feed post).
import fs from 'node:fs';
import path from 'node:path';
import { request, sleep } from '../lib/http.mjs';

export const REEL_MAX_SECONDS = 90;

export async function postFacebook({ post, manifest, url, local, cfg, log }) {
  const g = cfg.graph;
  if (!g.pageId || !g.pageToken) throw new Error('Facebook is not set up: META_PAGE_ID and META_PAGE_TOKEN are needed');
  const api = `${g.base}/${g.version}`;
  const message = post.captions.facebook;

  if (manifest.type === 'reel' && manifest.duration > REEL_MAX_SECONDS) {
    const file = local(manifest.video);
    const form = new FormData();
    form.append('access_token', g.pageToken);
    form.append('title', post.series || post.captions.tiktok_title || '');
    form.append('description', message);
    if (cfg.rehearsal) form.append('published', 'false');
    form.append('source', new Blob([fs.readFileSync(file)], { type: 'video/mp4' }), path.basename(file));
    const r = await request('POST', `${g.video}/${g.version}/${g.pageId}/videos`, { body: form, retries: 0 });
    return { id: r.id, ...(cfg.rehearsal && { rehearsal: true }) };
  }

  if (manifest.type === 'reel') {
    const start = await request('POST', `${api}/${g.pageId}/video_reels`, { json: { upload_phase: 'start', access_token: g.pageToken } });
    const videoId = start.video_id;
    const video = fs.readFileSync(local(manifest.video));
    await request('POST', `${g.rupload}/video-upload/${g.version}/${videoId}`, { body: video,
      headers: { Authorization: `OAuth ${g.pageToken}`, offset: '0', file_size: String(video.length), 'Content-Type': 'application/octet-stream' } });
    // Wait until Facebook has fetched the file before publishing.
    for (let i = 0; i < 24; i++) {
      const s = await request('GET', `${api}/${videoId}?fields=status&access_token=${encodeURIComponent(g.pageToken)}`);
      const v = s?.status?.video_status;
      if (v === 'upload_complete' || v === 'ready' || s?.status?.uploading_phase?.status === 'complete') break;
      if (v === 'error') throw new Error('Facebook could not process the reel upload: ' + JSON.stringify(s.status));
      if (i % 6 === 0) log(`    facebook: reel upload is ${v || 'pending'}…`);
      await sleep(cfg.pollMs);
    }
    if (cfg.rehearsal) return { id: videoId, rehearsal: true };
    await request('POST', `${api}/${g.pageId}/video_reels`, { retries: 0, form: {
      video_id: videoId, upload_phase: 'finish', video_state: 'PUBLISHED', description: message, access_token: g.pageToken } });
    return { id: videoId };
  }

  if (manifest.images.length === 1) {
    const r = await request('POST', `${api}/${g.pageId}/photos`, { retries: 0, form: {
      url: url(manifest.images[0]), caption: message, published: cfg.rehearsal ? 'false' : undefined, access_token: g.pageToken } });
    return { id: r.post_id || r.id, ...(cfg.rehearsal && { rehearsal: true }) };
  }
  const form = { message, access_token: g.pageToken };
  for (const [i, img] of manifest.images.entries()) {
    const r = await request('POST', `${api}/${g.pageId}/photos`, { form: { url: url(img), published: 'false', access_token: g.pageToken } });
    form[`attached_media[${i}]`] = { media_fbid: r.id };
  }
  if (cfg.rehearsal) return { id: form['attached_media[0]'].media_fbid, rehearsal: true };
  const feed = await request('POST', `${api}/${g.pageId}/feed`, { form, retries: 0 });
  return { id: feed.id };
}
