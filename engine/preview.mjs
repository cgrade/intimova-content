// Writes content/<week>/PREVIEW.md: the week at a glance, used as the pull request description.
// Usage: node engine/preview.mjs content/2026-11-02
import fs from 'node:fs';
import path from 'node:path';
import { loadPost, manifestOf } from '../lib/post.mjs';
import { runwayReport } from './runway.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const weekDir = path.resolve(process.argv[2] || '');
const week = path.basename(weekDir);
const repoUrl = process.env.REPO_URL || ''; // e.g. https://github.com/owner/intimova-content
const branch = process.env.BRANCH || `week/${week}`;
const fileLink = rel => (repoUrl ? `${repoUrl}/blob/${branch}/${rel}?raw=true` : `../../${rel}`);

const fmt = iso => new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const posts = fs.readdirSync(weekDir).filter(s => fs.existsSync(path.join(weekDir, s, 'post.json'))).sort().map(s => loadPost(path.join(weekDir, s, 'post.json')));

const out = [`# Intimova: week of ${week}`, '', 'Merge this pull request to approve the week. Comment on anything you want changed.', '',
  '| When (Lagos) | Post | Format | Platforms |', '| --- | --- | --- | --- |'];
for (const p of posts) out.push(`| ${fmt(p.publish_at)} | ${p.id}${p.hold ? ' (on hold)' : ''} | ${p.format} | ${p.platforms.join(', ')} |`);
for (const p of posts) {
  const m = manifestOf(ROOT, p);
  const base = `public/${p._week}/${p._slug}`;
  out.push('', `## ${fmt(p.publish_at)} · ${p.id}`, '');
  if (!m) out.push('_Not rendered yet._');
  else if (m.type === 'reel') out.push(`<img src="${fileLink(base + '/' + m.cover)}" width="240">`, '', `[Watch the reel (${m.duration}s)](${fileLink(base + '/' + m.video)})`);
  else out.push(m.images.map(i => `<img src="${fileLink(base + '/' + i)}" width="200">`).join(' '));
  const c = p.captions;
  out.push('', '**Instagram**', '', '> ' + c.instagram.replace(/\n/g, '\n> '));
  out.push('', '**X**', '', [c.x, ...(c.x_thread || [])].map(t => '> ' + t.replace(/\n/g, '\n> ')).join('\n>\n> ↳ '));
  out.push('', `**TikTok** · ${c.tiktok_title || ''}`, '', '> ' + c.tiktok.replace(/\n/g, '\n> '));
  const s = p.safety;
  out.push('', `Safety: explicit ${s.explicit ? '❌' : 'no ✅'} · health claim ${s.health_claim ? 'yes, sourced ✅' : 'none'} · clear faces ${s.clear_faces ? '❌' : 'no ✅'}`);
  if (p.library) out.push('', `From the library: ${[].concat(p.library).map(id => '`' + id + '`').join(', ')}`);
  if (p.product) out.push('', `Product: \`${p.product.slug}\` at ₦${Number(p.product.price).toLocaleString('en-NG')}. The publisher checks the shop before posting and holds the post if the price or stock has changed.`);
}
out.push('', '---', '', (await runwayReport(ROOT, { weekStart: new Date(week + 'T00:00:00+01:00'), liveCheck: true, md: true })).text);
const need = path.join(weekDir, 'NEEDS-INPUT.md');
if (fs.existsSync(need)) out.push('', '---', '', fs.readFileSync(need, 'utf8'));
fs.writeFileSync(path.join(weekDir, 'PREVIEW.md'), out.join('\n') + '\n');
console.log('wrote ' + path.join(weekDir, 'PREVIEW.md'));
