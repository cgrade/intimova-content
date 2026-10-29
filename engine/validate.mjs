// Checks every upcoming post (captions within limits, safety fields set, media rendered) and the content library.
// Usage: node engine/validate.mjs   (exits 1 if anything is wrong)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAllPosts, validatePost, manifestOf, localMedia, assetsIgnoreText } from '../lib/post.mjs';
import { loadLibrary, validateLibrary, SLOTS, slotItems } from '../lib/library.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = Date.now();
let bad = 0;
const lib = loadLibrary(ROOT);
const libraryProblems = validateLibrary(lib);
if (libraryProblems.length) { bad++; console.log('✗ library/\n  - ' + libraryProblems.join('\n  - ')); }
const ignoreFile = path.join(ROOT, 'public', '.assetsignore');
if ((fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, 'utf8') : '') !== assetsIgnoreText(ROOT)) {
  bad++; console.log('✗ public/.assetsignore is out of date: run npm run render for the week (it rewrites the file)');
}
const libraryIds = new Set(SLOTS.flatMap(s => slotItems(lib, s.key).map(it => it.id)));
for (const post of loadAllPosts(ROOT)) {
  if (Date.parse(post.publish_at) < now - 24 * 3600 * 1000) continue; // past posts are history
  const e = validatePost(post);
  for (const id of [].concat(post.library || [])) if (!libraryIds.has(id)) e.push(`library id "${id}" isn't in library/`);
  if (post.product && !(lib.products.catalogue[post.product.slug] && Number.isFinite(post.product.price))) e.push('product needs a catalogue slug and a numeric price, e.g. { "slug": "bullet-rechargeable", "price": 15000 }');
  const m = manifestOf(ROOT, post);
  if (!m) e.push('not rendered: run npm run render -- content/' + post._week);
  else {
    const files = m.type === 'reel' ? [m.video, m.cover] : m.images;
    for (const f of files) if (!fs.existsSync(localMedia(ROOT, post, f))) e.push('missing rendered file ' + f);
    if (m.type === 'reel' && m.duration > 180) e.push(`reel is ${m.duration}s; Instagram shows Reels of 3 minutes at most in the Reels tab`);
    for (const f of files) {
      const big = fs.existsSync(localMedia(ROOT, post, f)) && fs.statSync(localMedia(ROOT, post, f)).size > 25 * 1024 * 1024;
      if (big && !(m.type === 'reel' && f === m.video && m.hosted === false)) e.push(`${f} is over 25 MB, which the media host can't serve; re-render it`);
    }
  }
  if (post.hold) console.log(`⏸ ${post.id}: on hold, will not post`);
  if (e.length) { bad++; console.log(`✗ ${post.id}\n  - ${e.join('\n  - ')}`); }
  else console.log(`✓ ${post.id} · ${post.publish_at} · ${post.platforms.join(', ')}`);
}
process.exit(bad ? 1 : 0);
