// Saves what the Saturday draft needs from intimova.ng, because Claude's cloud runs can't reach the site:
//   state/products.json              live price and stock for every catalogue product
//   state/site/product-<slug>.txt    each product page's text (materials, care, delivery, returns)
//   state/site/article-<slug>.txt    the text of every article a library carousel is built on (not website-only ones)
//   state/site/product-<slug>.jpg    the product photo the catalogue approves ("photo"), when it's still on that product's page
// Run by the "Read post results and product prices" GitHub job every Saturday morning.
// Usage: node engine/site-snapshot.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary } from '../lib/library.mjs';
import { productFromHtml, SHOP_BASE } from '../lib/product.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Readable text of a page's main content: no scripts, styles, navigation or footer. */
export function pageText(html) {
  const main = (html.match(/<main[\s\S]*?<\/main>/i) || [html])[0];
  return main
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|h[1-6]|li|div|section|tr)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#8358;|&#x20A6;/gi, '₦')
    .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

/** Downloads the catalogue's approved photo, only if it is still one of this product's own images. */
async function savePhoto(slug, photo, images, siteDir) {
  const url = images.find(u => u.split('/').pop() === photo);
  if (!url) throw new Error(`approved photo ${photo} is no longer on the product page; kept the last copy`);
  const res = await fetch(url, { headers: { 'User-Agent': 'intimova-content/1 (weekly snapshot)' } });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  fs.writeFileSync(path.join(siteDir, `product-${slug}.jpg`), Buffer.from(await res.arrayBuffer()));
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'intimova-content/1 (weekly snapshot)' } });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.text();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const lib = loadLibrary(ROOT);
  const siteDir = path.join(ROOT, 'state', 'site');
  fs.mkdirSync(siteDir, { recursive: true });
  const fetchedAt = new Date().toISOString();
  const products = {};
  let failed = 0;

  for (const slug of Object.keys(lib.products.catalogue)) {
    const url = `${SHOP_BASE}/product/${slug}`;
    try {
      const html = await get(url);
      const p = productFromHtml(html);
      if (!p) throw new Error('no product data on the page');
      products[slug] = { slug, ...p };
      fs.writeFileSync(path.join(siteDir, `product-${slug}.txt`), `${url}\nSaved ${fetchedAt}\n\n${pageText(html)}\n`);
      console.log(`✓ product ${slug}: ₦${p.price.toLocaleString('en-NG')}, ${p.availability}`);
      const photo = lib.products.catalogue[slug].photo;
      if (photo) {
        try { await savePhoto(slug, photo, p.images || [], siteDir); console.log(`✓ photo ${slug}`); }
        catch (e) { failed++; console.log(`✗ photo ${slug}: ${e.message}`); }
      }
    } catch (e) { failed++; console.log(`✗ product ${slug}: ${e.message}`); }
  }
  const articles = [...new Set(lib.carousels.filter(c => c.status !== 'website-only').map(c => c.article).concat(lib.products.items.map(i => i.article)).filter(Boolean))];
  for (const url of articles) {
    const slug = url.split('/').pop();
    try {
      fs.writeFileSync(path.join(siteDir, `article-${slug}.txt`), `${url}\nSaved ${fetchedAt}\n\n${pageText(await get(url))}\n`);
      console.log(`✓ article ${slug}`);
    } catch (e) { failed++; console.log(`✗ article ${slug}: ${e.message}`); }
  }
  // Only replace the price snapshot when every product was read, so a half-failed run can't hide a product.
  if (Object.keys(products).length === Object.keys(lib.products.catalogue).length) {
    fs.writeFileSync(path.join(ROOT, 'state', 'products.json'), JSON.stringify({ fetched_at: fetchedAt, products }, null, 2) + '\n');
  }
  process.exit(failed ? 1 : 0);
}
