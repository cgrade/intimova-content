// Renders a carousel (or a single image) to 1080x1350 JPEGs: slide-1.jpg, slide-2.jpg, ...
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function renderCarousel(deck, outDir) {
  const { chromium } = require('playwright');
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (/^slide-\d+\.jpg$/.test(f)) fs.rmSync(path.join(outDir, f));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1400 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(d => { window.DECK = d; }, deck);
    await page.goto('file://' + path.join(HERE, 'deck.html'));
    await page.evaluate(() => document.fonts.ready);
    if (errors.length) throw new Error('Template error: ' + errors.join('; '));
    await page.waitForTimeout(200);
    const slides = await page.$$('.slide');
    const images = [];
    for (let i = 0; i < slides.length; i++) {
      const name = `slide-${i + 1}.jpg`;
      await slides[i].screenshot({ path: path.join(outDir, name), type: 'jpeg', quality: 92 });
      images.push(name);
    }
    return { images };
  } finally { await browser.close(); }
}
