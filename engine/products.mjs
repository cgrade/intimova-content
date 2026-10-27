// Live price and stock for every product in the library catalogue, read from intimova.ng.
// Where the shop can't be reached (Claude's cloud sandbox), shows the Saturday snapshot in state/products.json.
// Usage: node engine/products.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary } from '../lib/library.mjs';
import { fetchProducts } from '../lib/product.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { catalogue } = loadLibrary(ROOT).products;
const { products, from, failed = [] } = await fetchProducts(ROOT, Object.keys(catalogue));
if (from !== 'live') console.log(`(intimova.ng couldn't be reached; showing the ${from === 'unavailable' ? 'no saved data' : from})\n`);
for (const [slug, entry] of Object.entries(catalogue)) {
  const p = products[slug];
  if (!p) { console.log(`? ${slug.padEnd(24)} not available`); continue; }
  const price = `₦${p.price.toLocaleString('en-NG')}`;
  console.log(`${p.inStock ? '✓' : '✗'} ${slug.padEnd(24)} ${price.padStart(8)}  ${p.availability.padEnd(11)} ${entry.status === 'hold' ? 'on hold for Grade  ' : ''}${p.url}`);
}
process.exit(failed.length || from === 'unavailable' ? 1 : 0);
