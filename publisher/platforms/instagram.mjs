// Instagram via the Graph API (Instagram API with Facebook Login), graph.facebook.com.
// Carousel: one container per image (is_carousel_item) -> CAROUSEL container -> media_publish.
// Reel: REELS container with video_url -> wait for FINISHED -> media_publish.
import { request, sleep, ApiError } from '../lib/http.mjs';

async function waitFinished(api, id, token, { pollMs, log, maxPolls = 36 }) {
  for (let i = 0; i < maxPolls; i++) {
    const r = await request('GET', `${api}/${id}?fields=status_code&access_token=${encodeURIComponent(token)}`);
    if (r.status_code === 'FINISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') throw new ApiError(`Instagram container ${id} status ${r.status_code}`, { body: r });
    if (i % 6 === 0) log(`    instagram: container ${id} is ${r.status_code || 'pending'}…`);
    await sleep(pollMs);
  }
  throw new ApiError(`Instagram container ${id} was not ready in time`);
}

export async function postInstagram({ post, manifest, url, cfg, log }) {
  const g = cfg.graph;
  const token = g.igToken || g.pageToken;
  if (!g.igUserId || !token) throw new Error('Instagram is not set up: IG_USER_ID and META_PAGE_TOKEN are needed');
  const api = `${g.base}/${g.version}`;
  const caption = post.captions.instagram;
  let creationId;

  if (manifest.type === 'reel') {
    const r = await request('POST', `${api}/${g.igUserId}/media`, { form: {
      media_type: 'REELS', video_url: url(manifest.video), cover_url: manifest.cover ? url(manifest.cover) : undefined,
      caption, share_to_feed: 'true', access_token: token } });
    creationId = r.id;
    await waitFinished(api, creationId, token, { pollMs: cfg.pollMs, log });
  } else if (manifest.images.length === 1) {
    const r = await request('POST', `${api}/${g.igUserId}/media`, { form: { image_url: url(manifest.images[0]), caption, access_token: token } });
    creationId = r.id;
    await waitFinished(api, creationId, token, { pollMs: cfg.pollMs, log });
  } else {
    const children = [];
    for (const img of manifest.images.slice(0, 20)) {
      const r = await request('POST', `${api}/${g.igUserId}/media`, { form: { image_url: url(img), is_carousel_item: 'true', access_token: token } });
      children.push(r.id);
    }
    for (const c of children) await waitFinished(api, c, token, { pollMs: cfg.pollMs, log });
    const r = await request('POST', `${api}/${g.igUserId}/media`, { form: { media_type: 'CAROUSEL', children: children.join(','), caption, access_token: token } });
    creationId = r.id;
    await waitFinished(api, creationId, token, { pollMs: cfg.pollMs, log });
  }
  // No automatic retry on the publish call itself, so a slow success can't turn into a double post.
  const pub = await request('POST', `${api}/${g.igUserId}/media_publish`, { form: { creation_id: creationId, access_token: token }, retries: 0 });
  return { id: pub.id };
}
