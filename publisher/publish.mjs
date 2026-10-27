// Publishes every approved post whose time has come. Run every 10 minutes by GitHub Actions.
// A post is approved when it is on the main branch and has no "hold": true.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { loadAllPosts, validatePost, manifestOf, mediaUrl, localMedia } from '../lib/post.mjs';
import { loadState, saveState, loadTokens, saveTokens } from './lib/store.mjs';
import { fetchProduct, productProblem } from '../lib/product.mjs';
import { head, request } from './lib/http.mjs';
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
  const kits = [];
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
    // A product post names its price on the slides, so hold it if the shop has changed since it was approved.
    const pending = post.platforms.some(p => cfg.platforms.includes(p) && !(state[post.id]?.[p]?.done || state[post.id]?.[p]?.gave_up));
    if (post.product?.slug && pending) {
      let live;
      try { live = await fetchProduct(post.product.slug, { base: cfg.shopBase }); }
      catch (e) {
        log(`  … couldn't check ${post.product.slug} on the shop (${e.message}); will try next run`);
        results.push({ post: post.id, platform: '-', ok: false, waiting: true, note: 'shop not reachable to check the product' });
        continue;
      }
      const why = productProblem(post.product, live);
      if (why) {
        log(`  ✗ held: ${why}. Fix the post (or set "hold": true) and push.`);
        results.push({ post: post.id, platform: '-', ok: false, note: `held: ${why}` });
        continue;
      }
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

    // TikTok by hand: when TikTok isn't automated, send Grade the files and caption to post himself.
    if (post.platforms.includes('tiktok') && !cfg.platforms.includes('tiktok')) {
      const m = (st.tiktok_manual ||= { attempts: 0 });
      if (m.notified) { log(`  = tiktok (by hand): already sent, issue #${m.issue}`); continue; }
      if (m.attempts >= cfg.maxAttempts) { log('  = tiktok (by hand): gave up earlier'); continue; }
      if (!(await ensureLive())) {
        log('  … tiktok (by hand): waiting until the media is live');
        results.push({ post: post.id, platform: 'tiktok (by hand)', ok: false, waiting: true, note: 'media not live yet' });
        continue;
      }
      const kit = tiktokKit(post, manifest, url, cfg);
      kits.push(kit);
      if (cfg.dryRun) { results.push({ post: post.id, platform: 'tiktok (by hand)', ok: true, dry: true }); continue; }
      if (!cfg.github.token || !cfg.github.repo) { log('  ~ tiktok (by hand): no GITHUB_TOKEN, kit is in the run summary only'); continue; }
      m.attempts++;
      try {
        const issue = await request('POST', `${cfg.github.api}/repos/${cfg.github.repo}/issues`, {
          headers: { Authorization: `Bearer ${cfg.github.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
          json: { title: kit.title, body: kit.body }, retries: 1 });
        Object.assign(m, { notified: true, issue: issue.number, url: issue.html_url, at: new Date().toISOString() });
        log(`  ✓ tiktok (by hand): issue #${issue.number}`);
        results.push({ post: post.id, platform: 'tiktok (by hand)', ok: true, id: `issue #${issue.number}` });
      } catch (e) {
        log(`  ✗ tiktok (by hand): could not open the GitHub issue: ${e.message}`);
        results.push({ post: post.id, platform: 'tiktok (by hand)', ok: false, note: e.message });
      }
      saveState(cfg.root, state);
    }
  }
  if (!cfg.dryRun && cfg.tokensKey && JSON.stringify(tokens) !== tokensBefore) saveTokens(cfg.root, tokens, cfg.tokensKey);
  const warnings = [];
  const ttEnd = tokens.tiktok?.refresh_expires_at;
  if (ttEnd && ttEnd - cfg.now.getTime() < 30 * 24 * 3600 * 1000) warnings.push(`TikTok login ends on ${new Date(ttEnd).toDateString()}. Rerun npm run setup:tiktok before then.`);
  for (const w of warnings) log('⚠ ' + w);
  writeSummary(cfg, due, results, warnings, kits);
  return results;
}

/** Everything Grade needs to post one item on TikTok himself. */
export function tiktokKit(post, manifest, url, cfg) {
  const c = post.captions || {};
  const name = post.series || c.tiktok_title || post.id;
  const files = manifest.type === 'reel' ? [manifest.video] : manifest.images;
  const who = cfg.github?.notifyUser ? `@${cfg.github.notifyUser} ` : '';
  const steps = manifest.type === 'reel'
    ? ['Open the video link below and save it to your phone.', 'In TikTok, tap **+**, then **Upload**, and pick the video.', manifest.score ? 'It already has its own soundtrack, so keep the original sound on. If you add a TikTok sound, turn it down low so the score still carries. Then paste the caption below.' : 'Add a sound if you like, then paste the caption below.']
    : ['Open each image link below and save it to your phone, in order.', `In TikTok, tap **+**, then **Upload**, and pick the ${files.length > 1 ? `${files.length} images in order` : 'image'}. TikTok makes them a photo post.`, 'Add a sound, then paste the title and caption below.'];
  const body = [
    `${who}it's time to post this on TikTok.`, '',
    `**${name}** · ${manifest.type === 'reel' ? `reel, ${manifest.duration}s` : `${files.length} image${files.length > 1 ? 's' : ''}`}`, '',
    ...steps.map((s, i) => `${i + 1}. ${s}`), '',
    '**Files**', ...files.map((f, i) => `- [${manifest.type === 'reel' ? 'Video' : `Slide ${i + 1}`}](${url(f)})`), '',
    ...(manifest.type === 'reel' ? [] : ['**Title**', '```', c.tiktok_title || '', '```', '']),
    '**Caption**', '```', c.tiktok || '', '```', '',
    ...(post.ai_generated ? ['Turn on TikTok\'s "AI-generated content" label for this post.', ''] : []),
    'Close this issue once it\'s posted.'];
  return { post: post.id, title: `Post to TikTok: ${name}`, body: body.join('\n') };
}

function writeSummary(cfg, due, results, warnings = [], kits = []) {
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
  for (const k of kits) lines.push('', `### ${k.title}`, '', k.body);
  fs.appendFileSync(cfg.summaryFile, lines.join('\n') + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await run();
  const failed = results.filter(r => !r.ok && !r.waiting);
  process.exit(failed.length ? 1 : 0);
}
