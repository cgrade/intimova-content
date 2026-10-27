// Live price and stock for every product in the library catalogue, read from intimova.ng.
// Usage: node engine/products.mjs [--save]
//   --save  also writes state/products.json, the snapshot used where the shop can't be reached
//           (Claude's cloud sandbox can't reach intimova.ng; GitHub Actions saves this every Saturday).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary } from '../lib/library.mjs';
import { fetchProducts } from '../lib/product.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { catalogue } = loadLibrary(ROOT).products;
const save = process.argv.includes('--save');
const { products, from, failed = [] } = await fetchProducts(save ? null : ROOT, Object.keys(catalogue));
if (from !== 'live') console.log(`(intimova.ng couldn't be reached; showing the ${from === 'unavailable' ? 'no saved data' : from})\n`);
for (const [slug, entry] of Object.entries(catalogue)) {
  const p = products[slug];
  if (!p) { console.log(`? ${slug.padEnd(24)} not available`); continue; }
  const price = `₦${p.price.toLocaleString('en-NG')}`;
  console.log(`${p.inStock ? '✓' : '✗'} ${slug.padEnd(24)} ${price.padStart(8)}  ${p.availability.padEnd(11)} ${entry.status === 'hold' ? 'on hold for Grade  ' : ''}${p.url}`);
}
if (save) {
  if (from !== 'live') { console.error('Not saving: some products could not be read live.'); process.exit(1); }
  fs.writeFileSync(path.join(ROOT, 'state', 'products.json'), JSON.stringify({ fetched_at: new Date().toISOString(), products }, null, 2) + '\n');
  console.log('\nsaved state/products.json');
}
process.exit(failed.length || from === 'unavailable' ? 1 : 0);
