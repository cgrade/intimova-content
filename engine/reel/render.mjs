// Renders a story reel: animated words over the moving satin background.
// Output: <outDir>/reel.mp4 (1080x1920, H.264, AAC 48 kHz) and <outDir>/cover.jpg.
// Needs: Playwright with Chromium, ffmpeg, python3 with numpy and Pillow.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const MAX_FILE_BYTES = 24 * 1024 * 1024; // stays under Cloudflare Pages' per-file limit

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
    throw new Error(`Story runs ${meta.total.toFixed(1)}s even when sped up; the limit is ${story.max_seconds || 89.5}s. Cut some lines.`);
  }
  const frames = Math.ceil(meta.total * FPS);
  fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify({ ...meta, fps: FPS, frames }));
  log(`reel: ${meta.total.toFixed(1)}s, ${frames} frames (pace x${(1 / meta.scale).toFixed(2)})`);

  // Background renders in parallel with the text frames.
  const bgPath = path.join(tmp, 'bg.mp4');
  const bg = run('python3', [path.join(HERE, 'satin.py'), String(meta.total), bgPath, '-', '0', path.join(tmp, 'meta.json')]);

  const stage = await page.$('#stage');
  for (let i = 0; i < frames; i++) {
    await page.evaluate(t => window.render(t), i / FPS);
    await stage.screenshot({ path: path.join(tmp, String(i).padStart(5, '0') + '.png'), omitBackground: true });
    if (i % 300 === 0) log(`  text frame ${i}/${frames}`);
  }
  await browser.close();
  await bg;

  const out = path.join(outDir, 'reel.mp4');
  const D = meta.total;
  const encode = crf => run('ffmpeg', ['-y', '-loglevel', 'error',
    '-i', bgPath, '-framerate', String(FPS), '-i', path.join(tmp, '%05d.png'),
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-filter_complex', `[0:v]noise=alls=3:allf=t[b];[b][1:v]overlay=0:0:format=auto,fade=t=in:st=0:d=0.6,fade=t=out:st=${(D - 0.7).toFixed(3)}:d=0.7,format=yuv420p[v]`,
    '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-crf', String(crf), '-maxrate', '9M', '-bufsize', '18M', '-preset', 'slow',
    '-profile:v', 'high', '-r', String(FPS), '-g', String(FPS * 2), '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
    '-t', D.toFixed(3), '-movflags', '+faststart', out]);
  await encode(20);
  if (fs.statSync(out).size > MAX_FILE_BYTES) { log('  file over 24 MB, re-encoding smaller'); await encode(25); }

  // Cover: the hook, fully revealed.
  const coverAt = story.cover_at ?? 3.0;
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(coverAt), '-i', out, '-frames:v', '1', '-q:v', '3', path.join(outDir, 'cover.jpg')]);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { video: 'reel.mp4', cover: 'cover.jpg', duration: Number(D.toFixed(2)), bytes: fs.statSync(out).size };
}
