// Facebook Page via the Graph API.
// Photos: /{page}/photos (published=false for each) -> /{page}/feed with attached_media.
// Reel: /{page}/video_reels start -> rupload with file_url -> finish with video_state=PUBLISHED.
import { request, sleep } from '../lib/http.mjs';

export async function postFacebook({ post, manifest, url, cfg, log }) {
  const g = cfg.graph;
  if (!g.pageId || !g.pageToken) throw new Error('Facebook is not set up: META_PAGE_ID and META_PAGE_TOKEN are needed');
  const api = `${g.base}/${g.version}`;
  const message = post.captions.facebook;

  if (manifest.type === 'reel') {
    if (manifest.duration > 90) throw new Error(`Facebook Reels must be 90 seconds or less; this one is ${manifest.duration}s`);
    const start = await request('POST', `${api}/${g.pageId}/video_reels`, { json: { upload_phase: 'start', access_token: g.pageToken } });
    const videoId = start.video_id;
    await request('POST', `${g.rupload}/video-upload/${g.version}/${videoId}`, {
      headers: { Authorization: `OAuth ${g.pageToken}`, file_url: url(manifest.video) } });
    // Wait until Facebook has fetched the file before publishing.
    for (let i = 0; i < 24; i++) {
      const s = await request('GET', `${api}/${videoId}?fields=status&access_token=${encodeURIComponent(g.pageToken)}`);
      const v = s?.status?.video_status;
      if (v === 'upload_complete' || v === 'ready' || s?.status?.uploading_phase?.status === 'complete') break;
      if (v === 'error') throw new Error('Facebook could not process the reel upload: ' + JSON.stringify(s.status));
      if (i % 6 === 0) log(`    facebook: reel upload is ${v || 'pending'}…`);
      await sleep(cfg.pollMs);
    }
    await request('POST', `${api}/${g.pageId}/video_reels`, { retries: 0, form: {
      video_id: videoId, upload_phase: 'finish', video_state: 'PUBLISHED', description: message, access_token: g.pageToken } });
    return { id: videoId };
  }

  if (manifest.images.length === 1) {
    const r = await request('POST', `${api}/${g.pageId}/photos`, { retries: 0, form: { url: url(manifest.images[0]), caption: message, access_token: g.pageToken } });
    return { id: r.post_id || r.id };
  }
  const form = { message, access_token: g.pageToken };
  for (const [i, img] of manifest.images.entries()) {
    const r = await request('POST', `${api}/${g.pageId}/photos`, { form: { url: url(img), published: 'false', access_token: g.pageToken } });
    form[`attached_media[${i}]`] = { media_fbid: r.id };
  }
  const feed = await request('POST', `${api}/${g.pageId}/feed`, { form, retries: 0 });
  return { id: feed.id };
}
