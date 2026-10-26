// Renders every post in a week folder into public/<week>/<post>/ and writes a manifest.json for each.
// Usage: node engine/render-week.mjs content/2026-11-02 [--force] [--only <post-folder>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { renderReel } from './reel/render.mjs';
import { renderCarousel } from './carousel/render.mjs';
import { loadPost, validatePost } from '../lib/post.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const weekDir = path.resolve(args.find(a => !a.startsWith('--')) || '');
const force = args.includes('--force');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
if (!fs.existsSync(weekDir)) { console.error('Week folder not found: ' + weekDir); process.exit(1); }

const week = path.basename(weekDir);
let failed = 0;
for (const slug of fs.readdirSync(weekDir).sort()) {
  const postFile = path.join(weekDir, slug, 'post.json');
  if (!fs.existsSync(postFile) || (only && only !== slug)) continue;
  const post = loadPost(postFile);
  const problems = validatePost(post);
  if (problems.length) { console.error(`✗ ${slug}:\n  - ` + problems.join('\n  - ')); failed++; continue; }
  const outDir = path.join(ROOT, 'public', week, slug);
  const manifestFile = path.join(outDir, 'manifest.json');
  const src = post.format === 'reel' ? post.story : post.slides;
  const hash = crypto.createHash('sha256').update(JSON.stringify({ engine: 2, format: post.format, src, series: post.series_label, footer: post.last_footer })).digest('hex').slice(0, 16);
  if (!force && fs.existsSync(manifestFile) && JSON.parse(fs.readFileSync(manifestFile, 'utf8')).hash === hash) {
    console.log(`= ${slug}: already rendered`); continue;
  }
  console.log(`→ ${slug} (${post.format})`);
  try {
    let result;
    if (post.format === 'reel') result = await renderReel(post.story, outDir);
    else result = await renderCarousel({ series: post.series_label, slides: post.slides, last_footer: post.last_footer }, outDir);
    const manifest = { type: post.format, hash, rendered_at: new Date().toISOString(), ...result };
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    console.log(`✓ ${slug}: ${JSON.stringify(result)}`);
  } catch (e) { console.error(`✗ ${slug}: ${e.message}`); failed++; }
}
process.exit(failed ? 1 : 0);
