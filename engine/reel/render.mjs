// Renders a story reel: animated words over the moving satin background.
// Output: <outDir>/reel.mp4 (1080x1920, H.264, AAC 48 kHz) and <outDir>/cover.jpg.
// Needs: Playwright with Chromium, ffmpeg, python3 with numpy and Pillow.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const PAGE_FRAMES = 1000; // frames one page renders before it is replaced with a fresh one
export const HOSTED_MAX_BYTES = 24 * 1024 * 1024; // Cloudflare serves files up to 25 MiB; bigger reels are uploaded to Meta as bytes
const MAX_FILE_BYTES = 95 * 1024 * 1024;          // GitHub refuses files over 100 MB

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], ...opts });
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

/** Lays out the story and returns its timing without rendering anything. */
export async function planReel(story) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    await page.addInitScript(s => { window.STORY = s; }, story);
    await page.goto('file://' + path.join(HERE, 'stage.html'));
    await page.evaluate(() => document.fonts.ready);
    return await page.evaluate(() => ({ total: window.TOTAL, scale: window.SCALE, fits: window.FITS, cues: window.CUES, sceneEnds: window.SCENE_T1 }));
  } finally { await browser.close(); }
}

export async function renderReel(story, outDir, { log = console.log } = {}) {
  const { chromium } = require('playwright');
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = path.join(outDir, '.frames');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.addInitScript(s => { window.STORY = s; }, story);
  await page.goto('file://' + path.join(HERE, 'stage.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const meta = await page.evaluate(() => ({ total: window.TOTAL, scale: window.SCALE, fits: window.FITS, cues: window.CUES }));
  if (!meta.fits) {
    await browser.close();
    throw new Error(`Story runs ${meta.total.toFixed(1)}s even when sped up; the limit is ${story.max_seconds || 179.5}s. Cut some lines.`);
  }
  // Grade's floor (30 Oct 2026): story reels run at least 2 min 53 s. Refuse before spending ~40 minutes on frames.
  const floor = story.min_seconds ?? 173;
  if (meta.total < floor) {
    await browser.close();
    throw new Error(`Story runs ${meta.total.toFixed(1)}s; the floor is ${floor}s (2 min 53 s). Add some lines.`);
  }
  const frames = Math.ceil(meta.total * FPS);
  fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify({ ...meta, fps: FPS, frames }));
  log(`reel: ${meta.total.toFixed(1)}s, ${frames} frames (pace x${(1 / meta.scale).toFixed(2)})`);

  // Background and score render in parallel with the text frames.
  const bgPath = path.join(tmp, 'bg.mp4');
  // settle() keeps a failure here from crashing the process while text frames are still rendering.
  const settle = pr => pr.then(() => null, e => e);
  const bg = settle(run('python3', [path.join(HERE, 'satin.py'), String(meta.total), bgPath, '-', '0', path.join(tmp, 'meta.json')]));
  // Original score timed to the story's cues (pulse, turn, heat, peak, lights, dread, end). "music": "none" turns it off.
  const withScore = (story.music ?? 'score') !== 'none';
  const scorePath = path.join(tmp, 'score.wav');
  const score = settle(withScore ? run('python3', [path.join(HERE, 'score.py'), path.join(tmp, 'meta.json'), scorePath, String(story.music_seed ?? 11)]) : Promise.resolve());

  // Text frames: several workers render in parallel (a 3-minute reel is over 5,000 frames). Each worker
  // has its own browser, since pages in one browser share its compositor and barely run faster. Frames are
  // captured through DevTools with optimizeForSpeed (same pixels as page.screenshot, about 4x faster).
  // Each browser is replaced every PAGE_FRAMES frames, and a frame that hangs is retried on a fresh one,
  // because one Chromium page screenshotting thousands of frames can stall ("waiting for fonts to load").
  await browser.close();
  const openStage = async () => {
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
    await p.addInitScript(s => { window.STORY = s; }, story);
    await p.goto('file://' + path.join(HERE, 'stage.html'));
    await p.evaluate(() => document.fonts.ready);
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    const box = await (await p.$('#stage')).boundingBox();
    return { browser: b, page: p, cdp, clip: { ...box, scale: 1 }, used: 0 };
  };
  const timeout = (ms, what) => new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms).unref());
  const workers = Math.max(1, Math.min(4, os.availableParallelism() - 1));
  let next = 0, done = 0, failed = false;
  await Promise.all(Array.from({ length: workers }, async () => {
    let s = await openStage();
    try {
      for (let i = next++; i < frames && !failed; i = next++) {
        for (let attempt = 1; ; attempt++) {
          try {
            if (s.used >= PAGE_FRAMES) { await s.browser.close(); s = await openStage(); }
            await s.page.evaluate(t => window.render(t), i / FPS);
            const { data } = await Promise.race([
              s.cdp.send('Page.captureScreenshot', { format: 'png', clip: s.clip, optimizeForSpeed: true }),
              timeout(60000, 'screenshot'),
            ]);
            fs.writeFileSync(path.join(tmp, String(i).padStart(5, '0') + '.png'), Buffer.from(data, 'base64'));
            s.used++; break;
          } catch (e) {
            if (attempt >= 3) { failed = true; throw new Error(`text frame ${i} failed 3 times: ${e.message.split('\n')[0]}`); }
            log(`  text frame ${i}: ${e.message.split('\n')[0]}; retrying on a fresh browser`);
            await s.browser.close().catch(() => {});
            s = await openStage();
          }
        }
        if (++done % 500 === 0) log(`  text frames ${done}/${frames}`);
      }
    } finally { await s.browser.close().catch(() => {}); }
  }));
  const bgErr = await bg, scoreErr = await score;
  if (bgErr) throw new Error('Background render failed: ' + bgErr.message);
  if (scoreErr) throw new Error('Score failed (is scipy installed for python3?): ' + scoreErr.message);

  const out = path.join(outDir, 'reel.mp4');
  const D = meta.total;
  const audioIn = withScore ? ['-i', scorePath] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'];
  const encode = crf => run('ffmpeg', ['-y', '-loglevel', 'error',
    '-i', bgPath, '-framerate', String(FPS), '-i', path.join(tmp, '%05d.png'),
    ...audioIn,
    '-filter_complex', `[0:v]noise=alls=3:allf=t[b];[b][1:v]overlay=0:0:format=auto,fade=t=in:st=0:d=0.6,fade=t=out:st=${(D - 0.7).toFixed(3)}:d=0.7,format=yuv420p[v]`,
    '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-crf', String(crf), '-maxrate', '9M', '-bufsize', '18M', '-preset', 'slow',
    '-profile:v', 'high', '-r', String(FPS), '-g', String(FPS * 2), '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
    '-t', D.toFixed(3), '-movflags', '+faststart', out]);
  // Reels over 90 s always come out over 24 MB at CRF 20 (the grain is hard to compress), so they go straight to 25.
  const firstCrf = D > 90 ? 25 : 20;
  await encode(firstCrf);
  if (firstCrf < 25 && fs.statSync(out).size > HOSTED_MAX_BYTES) { log('  file over 24 MB, re-encoding smaller'); await encode(25); }
  const bytes = fs.statSync(out).size;
  if (bytes > MAX_FILE_BYTES) throw new Error(`Reel is ${(bytes / 1048576).toFixed(0)} MB even re-encoded; GitHub refuses files over 100 MB. Cut some lines.`);
  // Still too big for the media host: Instagram and Facebook get the bytes instead (see publisher/), and
  // render-week lists the file in public/.assetsignore so Cloudflare doesn't try to serve it.
  const hosted = bytes <= HOSTED_MAX_BYTES;
  if (!hosted) log(`  ${(bytes / 1048576).toFixed(1)} MB: too big for the media host, will be uploaded to Meta directly`);

  // Cover: the hook, fully revealed.
  const coverAt = story.cover_at ?? 3.0;
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(coverAt), '-i', out, '-frames:v', '1', '-q:v', '3', path.join(outDir, 'cover.jpg')]);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { video: 'reel.mp4', cover: 'cover.jpg', duration: Number(D.toFixed(2)), bytes, score: withScore, ...(!hosted && { hosted: false }) };
}
