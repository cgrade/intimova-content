// Reads a product's live price and stock from its intimova.ng page, using the schema.org Product data
// the page already publishes for search engines. Read-only: one GET per product, nothing on the site changes.
import fs from 'node:fs';
import path from 'node:path';

export const SHOP_BASE = 'https://intimova.ng';

/** Pulls the Product object out of a page's JSON-LD scripts. */
export function productFromHtml(html) {
  const scripts = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g);
  for (const [, body] of scripts) {
    let data;
    try { data = JSON.parse(body); } catch { continue; }
    for (const item of Array.isArray(data) ? data : data['@graph'] || [data]) {
      const type = [].concat(item['@type']);
      if (!type.includes('Product')) continue;
      const offer = [].concat(item.offers || [])[0] || {};
      return {
        name: item.name,
        price: Number(offer.price),
        currency: offer.priceCurrency,
        inStock: /InStock$/.test(offer.availability || ''),
        availability: String(offer.availability || '').split('/').pop(),
        url: offer.url,
      };
    }
  }
  return null;
}

export async function fetchProduct(slug, { base = SHOP_BASE, fetchImpl = fetch } = {}) {
  const url = `${base.replace(/\/$/, '')}/product/${encodeURIComponent(slug)}`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'intimova-content/1 (product check)' } });
  if (!res.ok) throw new Error(`product page ${url} returned ${res.status}`);
  const product = productFromHtml(await res.text());
  if (!product) throw new Error(`no product data found on ${url}`);
  return { slug, ...product };
}

/**
 * Live data for several products. Where the shop can't be reached (Claude's cloud sandbox blocks intimova.ng),
 * falls back to state/products.json, which GitHub Actions saves every Saturday morning.
 * Returns { products: { slug: data }, from: 'live' | 'snapshot <time>' | 'unavailable' }.
 */
export async function fetchProducts(root, slugs, opts = {}) {
  const products = {};
  const failed = [];
  for (const slug of slugs) {
    try { products[slug] = await fetchProduct(slug, opts); } catch { failed.push(slug); }
  }
  if (!failed.length) return { products, from: 'live' };
  const file = root && path.join(root, 'state', 'products.json');
  if (!file || !fs.existsSync(file)) return { products, from: failed.length === slugs.length ? 'unavailable' : 'live', failed };
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const slug of failed) if (snap.products[slug]) products[slug] = snap.products[slug];
  return { products, from: `snapshot of ${snap.fetched_at}`, failed: failed.filter(s => !products[s]) };
}

/**
 * Whether a post's product still matches the shop: same price as on the slides, and in stock.
 * Returns null when it's fine, or the reason to hold the post.
 */
export function productProblem(expected, live) {
  if (!live.inStock) return `${live.name} is ${live.availability || 'not in stock'} on the shop`;
  if (Number(expected.price) !== live.price) return `${live.name} costs ₦${live.price.toLocaleString('en-NG')} on the shop, but the post says ₦${Number(expected.price).toLocaleString('en-NG')}`;
  return null;
}
