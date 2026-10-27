// Live price and stock for every product in the library catalogue, read from intimova.ng.
// Usage: node engine/products.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary } from '../lib/library.mjs';
import { fetchProduct } from '../lib/product.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { catalogue } = loadLibrary(ROOT).products;
let failed = 0;
for (const [slug, entry] of Object.entries(catalogue)) {
  try {
    const p = await fetchProduct(slug);
    const price = `₦${p.price.toLocaleString('en-NG')}`;
    console.log(`${p.inStock ? '✓' : '✗'} ${slug.padEnd(24)} ${price.padStart(8)}  ${p.availability.padEnd(11)} ${entry.status === 'hold' ? 'on hold for Grade  ' : ''}${p.url}`);
  } catch (e) { failed++; console.log(`? ${slug.padEnd(24)} ${e.message}`); }
}
process.exit(failed ? 1 : 0);
