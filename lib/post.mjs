// Shared post loading and validation, used by the renderer and the publisher.
import fs from 'node:fs';
import path from 'node:path';

export const PLATFORMS = ['instagram', 'facebook', 'x', 'tiktok'];

export function loadPost(file) {
  const post = JSON.parse(fs.readFileSync(file, 'utf8'));
  post._file = file;
  post._slug = path.basename(path.dirname(file));
  post._week = path.basename(path.dirname(path.dirname(file)));
  return post;
}

/** Loads every post under content/<week>/<slug>/post.json. */
export function loadAllPosts(root) {
  const contentDir = path.join(root, 'content');
  const posts = [];
  if (!fs.existsSync(contentDir)) return posts;
  for (const week of fs.readdirSync(contentDir).sort()) {
    const wd = path.join(contentDir, week);
    if (!fs.statSync(wd).isDirectory()) continue;
    for (const slug of fs.readdirSync(wd).sort()) {
      const f = path.join(wd, slug, 'post.json');
      if (fs.existsSync(f)) posts.push(loadPost(f));
    }
  }
  return posts;
}

// X counts most characters as 1 and many emoji/CJK as 2; this is a close, conservative estimate.
export function xLength(text) {
  let n = 0;
  for (const ch of text.replace(/https?:\/\/\S+/g, 'x'.repeat(23))) n += ch.codePointAt(0) > 0x2000 ? 2 : 1;
  return n;
}
const hashtags = s => (s.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;

export function validatePost(p) {
  const e = [];
  if (!p.id) e.push('missing id');
  if (!['reel', 'carousel'].includes(p.format)) e.push('format must be "reel" or "carousel"');
  if (!p.publish_at || !/[+-]\d\d:\d\d$|Z$/.test(p.publish_at) || isNaN(Date.parse(p.publish_at))) e.push('publish_at must be an ISO time with a timezone, e.g. 2026-11-04T19:30:00+01:00');
  if (!Array.isArray(p.platforms) || !p.platforms.length || p.platforms.some(x => !PLATFORMS.includes(x))) e.push('platforms must list some of: ' + PLATFORMS.join(', '));
  const c = p.captions || {};
  for (const plat of p.platforms || []) {
    if (plat === 'tiktok') { if (!c.tiktok) e.push('missing captions.tiktok'); }
    else if (!c[plat]) e.push(`missing captions.${plat}`);
  }
  if (c.instagram && c.instagram.length > 2200) e.push(`Instagram caption is ${c.instagram.length} characters (max 2200)`);
  if (c.instagram && hashtags(c.instagram) > 30) e.push('Instagram caption has more than 30 hashtags');
  for (const [i, t] of [c.x, ...(c.x_thread || [])].entries()) if (t && xLength(t) > 280) e.push(`X post ${i + 1} is about ${xLength(t)} characters (max 280)`);
  if (c.tiktok_title && [...c.tiktok_title].length > 90) e.push('TikTok title over 90 characters');
  if (c.tiktok && c.tiktok.length > 4000) e.push('TikTok description over 4000 characters');
  if (p.format === 'reel' && !(p.story && Array.isArray(p.story.scenes) && p.story.scenes.length)) e.push('reel needs story.scenes');
  if (p.format === 'carousel') {
    if (!Array.isArray(p.slides) || !p.slides.length) e.push('carousel needs slides');
    else if (p.slides.length > 10) e.push('keep carousels to 10 slides or fewer');
  }
  const s = p.safety || {};
  if (s.explicit !== false) e.push('safety.explicit must be false');
  if (s.health_claim && !s.health_sources?.length) e.push('health claims need safety.health_sources');
  if (s.clear_faces) e.push('safety.clear_faces is true: no clearly identifiable faces');
  return e;
}

/** Public URL for a rendered file. */
export function mediaUrl(base, post, file) {
  return `${base.replace(/\/$/, '')}/${post._week}/${post._slug}/${file}`;
}
export function manifestOf(root, post) {
  const f = path.join(root, 'public', post._week, post._slug, 'manifest.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}
export function localMedia(root, post, file) {
  return path.join(root, 'public', post._week, post._slug, file);
}
