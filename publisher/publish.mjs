// Publishes every approved post whose time has come. Run hourly by GitHub Actions.
// A post is approved when it is on the main branch and has no "hold": true.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { loadAllPosts, validatePost, manifestOf, mediaUrl, localMedia } from '../lib/post.mjs';
import { loadState, saveState, loadTokens, saveTokens } from './lib/store.mjs';
import { head } from './lib/http.mjs';
import { postInstagram } from './platforms/instagram.mjs';
import { postFacebook } from './platforms/facebook.mjs';
import { postX } from './platforms/x.mjs';
import { postTiktok } from './platforms/tiktok.mjs';

const POSTERS = { instagram: postInstagram, facebook: postFacebook, x: postX, tiktok: postTiktok };

export function isDue(post, cfg) {
  if (cfg.onlyPost) return post.id === cfg.onlyPost;
  if (post.hold) return false;
  const t = Date.parse(post.publish_at);
  const now = cfg.now.getTime();
  return now >= t && now - t <= cfg.maxLateHours * 3600 * 1000;
}

export async function run(cfg = loadConfig(), log = console.log) {
  const posts = loadAllPosts(cfg.root);
  const state = loadState(cfg.root);
  const tokens = cfg.tokensKey ? loadTokens(cfg.root, cfg.tokensKey) : {};
  const tokensBefore = JSON.stringify(tokens);
  const results = [];
  const due = posts.filter(p => isDue(p, cfg));
  log(`${cfg.dryRun ? '[DRY RUN] ' : ''}${due.length} post(s) due at ${cfg.now.toISOString()}`);

  for (const post of due) {
    log(`• ${post.id} (${post.format})`);
    const problems = validatePost(post);
    const manifest = manifestOf(cfg.root, post);
    if (!manifest) problems.push('not rendered yet (no manifest.json in public/)');
    if (problems.length) {
      for (const p of problems) log(`  ✗ ${p}`);
      results.push({ post: post.id, platform: '-', ok: false, note: problems.join('; ') });
      continue;
    }
    const url = f => mediaUrl(cfg.mediaBase, post, f);
    const local = f => localMedia(cfg.root, post, f);
    const firstFile = manifest.type === 'reel' ? manifest.video : manifest.images[0];
    const st = (state[post.id] ||= {});

    // Instagram, Facebook and TikTok fetch media from the public URL, so it must be live first.
    let mediaLive = null;
    const ensureLive = async () => (mediaLive ??= !!cfg.mediaBase && await head(url(firstFile)));

    for (const plat of post.platforms.filter(p => cfg.platforms.includes(p))) {
      const s = (st[plat] ||= { attempts: 0 });
      if (s.done || s.gave_up) { log(`  = ${plat}: ${s.done ? 'already posted' : 'gave up earlier'}`); continue; }
      if (plat !== 'x' && !(await ensureLive())) {
        log(`  … ${plat}: media isn't live at ${url(firstFile)} yet; will try next run`);
        results.push({ post: post.id, platform: plat, ok: false, waiting: true, note: 'media not live yet' });
        continue;
      }
      if (cfg.dryRun) { log(`  ~ ${plat}: would post ${manifest.type}`); results.push({ post: post.id, platform: plat, ok: true, dry: true }); continue; }
      s.attempts++; s.last_try = new Date().toISOString();
      try {
        const r = await POSTERS[plat]({ post, manifest, url, local, cfg, tokens, log });
        Object.assign(s, { done: true, at: new Date().toISOString(), ...r });
        delete s.error;
        log(`  ✓ ${plat}: ${r.id}${r.status ? ' (' + r.status + ')' : ''}`);
        results.push({ post: post.id, platform: plat, ok: true, id: r.id, needsCaption: r.needs_caption });
      } catch (e) {
        s.error = e.message;
        if (s.attempts >= cfg.maxAttempts) s.gave_up = true;
        log(`  ✗ ${plat}: ${e.message}${s.gave_up ? ' (giving up after ' + s.attempts + ' tries)' : ''}`);
        results.push({ post: post.id, platform: plat, ok: false, note: e.message });
      }
      if (!cfg.dryRun) saveState(cfg.root, state); // save after every platform so a crash can't cause a repost
    }
  }
  if (!cfg.dryRun && cfg.tokensKey && JSON.stringify(tokens) !== tokensBefore) saveTokens(cfg.root, tokens, cfg.tokensKey);
  const warnings = [];
  const ttEnd = tokens.tiktok?.refresh_expires_at;
  if (ttEnd && ttEnd - cfg.now.getTime() < 30 * 24 * 3600 * 1000) warnings.push(`TikTok login ends on ${new Date(ttEnd).toDateString()}. Rerun npm run setup:tiktok before then.`);
  for (const w of warnings) log('⚠ ' + w);
  writeSummary(cfg, due, results, warnings);
  return results;
}

function writeSummary(cfg, due, results, warnings = []) {
  if (!cfg.summaryFile) return;
  const lines = [`## Intimova publisher ${cfg.dryRun ? '(dry run)' : ''}`, '', `Checked at ${cfg.now.toISOString()}. ${due.length} post(s) due.`, '', ...warnings.map(w => `> ⚠ ${w}`), ''];
  if (results.length) {
    lines.push('| Post | Platform | Result |', '| --- | --- | --- |');
    for (const r of results) lines.push(`| ${r.post} | ${r.platform} | ${r.ok ? (r.dry ? 'would post' : '✅ ' + (r.id || '')) : (r.waiting ? '⏳ ' : '❌ ') + (r.note || '')} |`);
  }
  const captions = results.filter(r => r.needsCaption);
  if (captions.length) {
    lines.push('', '### TikTok drafts waiting in your inbox', 'Open the TikTok notification, add a sound, and paste this caption:');
    for (const r of captions) {
      const post = loadAllPosts(cfg.root).find(p => p.id === r.post);
      lines.push('', `**${r.post}**`, '', '```', post?.captions?.tiktok || '', '```');
    }
  }
  fs.appendFileSync(cfg.summaryFile, lines.join('\n') + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await run();
  const failed = results.filter(r => !r.ok && !r.waiting);
  process.exit(failed.length ? 1 : 0);
}
