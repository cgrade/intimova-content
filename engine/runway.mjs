// How many weeks of content each slot has left in the library, and what the next week would use.
// Usage: node engine/runway.mjs [YYYY-MM-DD of a Monday] [--live] [--md]
//   --live  checks product stock on intimova.ng (skips out-of-stock products)
//   --md    prints markdown, for PREVIEW.md
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary, validateLibrary, runway, LOW_WEEKS } from '../lib/library.mjs';
import { fetchProducts } from '../lib/product.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function runwayReport(root, { weekStart, liveCheck = false, md = false } = {}) {
  const lib = loadLibrary(root);
  const problems = validateLibrary(lib);
  let live = null;
  let stockFrom = null;
  if (liveCheck) {
    const r = await fetchProducts(root, Object.keys(lib.products.catalogue));
    live = r.products;
    stockFrom = r.from;
  }
  const rows = runway(root, lib, { weekStart, live });
  const out = [];
  if (md) {
    out.push('## Library runway', '', `How many more weeks each slot can run from \`library/\` before it needs new material. Below ${LOW_WEEKS} weeks is flagged.`, '',
      '| Day | Slot | Weeks left | On hold for Grade | Next up |', '| --- | --- | --- | --- | --- |');
    for (const r of rows) out.push(`| ${r.day} | ${r.label} | ${r.weeks}${r.low ? ' ⚠️' : ''} | ${r.held} | ${r.next ? '`' + r.next.id + '`' : '—'} |`);
    const low = rows.filter(r => r.low);
    if (low.length) out.push('', `⚠️ Running low: ${low.map(r => `${r.label} (${r.weeks} weeks)`).join(', ')}. Add vetted material to \`library/\` before it runs out.`);
  } else {
    for (const r of rows) out.push(`${r.day}  ${r.label.padEnd(20)} ${String(r.weeks).padStart(3)} weeks left${r.low ? '  ⚠ low' : ''}  ${r.held ? `(${r.held} on hold)` : ''}  next: ${r.next?.id || '—'}`);
  }
  if (live) {
    const gone = Object.entries(live).filter(([, p]) => p.inStock === false).map(([s]) => s);
    if (gone.length) out.push('', `Out of stock, skipped: ${gone.join(', ')}`);
    if (stockFrom !== 'live') out.push('', `Stock from: ${stockFrom === 'unavailable' ? 'nowhere (intimova.ng unreachable and no saved snapshot), so no product was skipped' : stockFrom}.`);
  }
  if (problems.length) out.push('', md ? '**Library problems:**' : 'Library problems:', ...problems.map(p => `- ${p}`));
  return { text: out.join('\n'), rows, problems };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const date = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const { text, problems } = await runwayReport(ROOT, { weekStart: date ? new Date(date + 'T00:00:00+01:00') : new Date(), liveCheck: args.includes('--live'), md: args.includes('--md') });
  console.log(text);
  process.exit(problems.length ? 1 : 0);
}
