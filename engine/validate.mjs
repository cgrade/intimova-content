// Checks every upcoming post: captions within limits, safety fields set, media rendered.
// Usage: node engine/validate.mjs   (exits 1 if anything is wrong)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAllPosts, validatePost, manifestOf, localMedia } from '../lib/post.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = Date.now();
let bad = 0;
for (const post of loadAllPosts(ROOT)) {
  if (Date.parse(post.publish_at) < now - 24 * 3600 * 1000) continue; // past posts are history
  const e = validatePost(post);
  const m = manifestOf(ROOT, post);
  if (!m) e.push('not rendered: run npm run render -- content/' + post._week);
  else {
    const files = m.type === 'reel' ? [m.video, m.cover] : m.images;
    for (const f of files) if (!fs.existsSync(localMedia(ROOT, post, f))) e.push('missing rendered file ' + f);
    if (m.type === 'reel' && m.duration > 90) e.push(`reel is ${m.duration}s; Facebook allows 90s at most`);
  }
  if (post.hold) console.log(`⏸ ${post.id}: on hold, will not post`);
  if (e.length) { bad++; console.log(`✗ ${post.id}\n  - ${e.join('\n  - ')}`); }
  else console.log(`✓ ${post.id} · ${post.publish_at} · ${post.platforms.join(', ')}`);
}
process.exit(bad ? 1 : 0);
