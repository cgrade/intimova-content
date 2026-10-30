// Tests for the content library, the runway, the shop product check and the results reader. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-api.mjs';
import { loadLibrary, validateLibrary, runway, usedIds } from '../lib/library.mjs';
import { productFromHtml, productProblem, fetchProducts } from '../lib/product.mjs';
import { run as publish } from '../publisher/publish.mjs';
import { run as readInsights, loadInsights } from '../publisher/insights.mjs';
import { loadConfig } from '../publisher/lib/config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = () => {};

/** A temp content root with a copy of the real library and the given posts (week -> slug -> post). */
function makeRoot(posts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intimova-lib-'));
  fs.cpSync(path.join(ROOT, 'library'), path.join(root, 'library'), { recursive: true });
  for (const [week, slugs] of Object.entries(posts)) for (const [slug, post] of Object.entries(slugs)) {
    fs.mkdirSync(path.join(root, 'content', week, slug), { recursive: true });
    fs.writeFileSync(path.join(root, 'content', week, slug, 'post.json'), JSON.stringify(post));
  }
  return root;
}
const post = (over = {}) => ({ id: 'p', format: 'carousel', publish_at: '2026-11-02T19:30:00+01:00', platforms: ['instagram'],
  captions: { instagram: 'ig' }, slides: [{ type: 'quote', quote: 'q' }], safety: { explicit: false, clear_faces: false }, ...over });

test('the real library has no broken references or duplicates', () => {
  assert.deepEqual(validateLibrary(loadLibrary(ROOT)), []);
});

test('runway skips used items, continues the story, fills all seven days and rests a product for 4 weeks', () => {
  const root = makeRoot({ '2026-11-02': {
    '1-mon': post({ id: 'a', library: 'orgasm-gap' }),
    '3-wed': post({ id: 'b', library: 'lily-2' }),
    '5-fri': post({ id: 'c', library: 'q-choosing-yourself' }),
    // Uses the first product item, but features the Wand, so the next item in order (wand-guide) must rest.
    '7-sun': post({ id: 'd', publish_at: '2026-11-08T19:30:00+01:00', library: 'rose-air-pulse-guide', product: { slug: 'the-wand', price: 20000 } }),
  } });
  const lib = loadLibrary(root);
  assert.equal(usedIds(root, lib).get('orgasm-gap'), 'a');
  const rows = Object.fromEntries(runway(root, lib, { weekStart: new Date('2026-11-09T00:00:00+01:00') }).map(r => [r.key, r]));
  assert.equal(rows.myths.next.id, 'intercourse-is-enough');      // orgasm-gap is used
  assert.equal(rows.stories.next.id, 'lily-3');                     // the series continues
  assert.deepEqual(runway(root, lib).map(r => r.day), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.equal(rows.asks.next.id, 'a-not-from-sex-alone');          // Thursday: Ask Intimova
  assert.equal(rows.quotes.next.kind, 'quote');
  assert.notEqual(rows.quotes.next.id, 'q-choosing-yourself');      // used on Friday
  assert.equal(rows.tips.next.kind, 'tip');                         // Saturday: tips only
  assert.equal(rows.tips.next.id, 't-ya-first-toy-no-guilt');       // tips alternate young adults and couples, in library order
  assert.equal(rows.products.next.id, 'bullet-classic-guide');      // wand-guide skipped: the Wand posted 1 day earlier
  assert.equal(rows.products.next.season, undefined);               // no seasonal item in November
});

test('runway offers a seasonal product in its window, and skips out-of-stock products', () => {
  const root = makeRoot();
  const lib = loadLibrary(root);
  const dec = runway(root, lib, { weekStart: new Date('2026-12-07T00:00:00+01:00') }).find(r => r.key === 'products');
  assert.equal(dec.next.id, 'treat-yourself-december');
  const live = { 'silk-water-based-glide': { inStock: false } };
  const withLive = runway(root, lib, { live }).find(r => r.key === 'products');
  const without = runway(root, lib).find(r => r.key === 'products');
  assert.equal(withLive.ready, without.ready - 1);
});

test('reads price and stock from a product page, and spots a changed price', () => {
  const html = '<script type="application/ld+json">{"@type":"WebSite"}</script><script type="application/ld+json">{"@type":"Product","name":"The Bullet","offers":{"price":15000,"priceCurrency":"NGN","availability":"https://schema.org/InStock"}}</script>';
  const p = productFromHtml(html);
  assert.deepEqual([p.name, p.price, p.inStock], ['The Bullet', 15000, true]);
  assert.equal(productProblem({ price: 15000 }, p), null);
  assert.match(productProblem({ price: 12000 }, p), /costs ₦15,000 on the shop, but the post says ₦12,000/);
  assert.match(productProblem({ price: 15000 }, { ...p, inStock: false, availability: 'OutOfStock' }), /OutOfStock/);
});

function publishRoot(product) {
  const root = makeRoot({ '2026-11-08': { '7-sun': post({ id: 'guide', publish_at: '2026-11-08T19:30:00+01:00', product }) } });
  const pub = path.join(root, 'public', '2026-11-08', '7-sun');
  fs.mkdirSync(pub, { recursive: true });
  fs.writeFileSync(path.join(pub, 'manifest.json'), JSON.stringify({ type: 'carousel', images: ['slide-1.jpg'] }));
  fs.writeFileSync(path.join(pub, 'slide-1.jpg'), 'x');
  return root;
}
const publishCfg = (root, mock) => loadConfig({ CONTENT_ROOT: root, NOW: '2026-11-08T19:40:00+01:00', MEDIA_BASE_URL: mock.base + '/media',
  SHOP_BASE_URL: mock.base + '/shop', GRAPH_BASE: mock.base + '/graph', META_PAGE_ID: 'PAGE1', META_PAGE_TOKEN: 'page-token', IG_USER_ID: 'IG123', PLATFORMS: 'instagram' });

test('publisher holds a product post when the shop price has changed, and posts it when it matches', async () => {
  const root = publishRoot({ slug: 'bullet-rechargeable', price: 15000 });
  const mock = await startMock({ publicDir: path.join(root, 'public'), products: { 'bullet-rechargeable': { price: 18000 } } });
  try {
    const held = await publish(publishCfg(root, mock), quiet);
    assert.equal(held.length, 1);
    assert.match(held[0].note, /^held: .*₦18,000 on the shop, but the post says ₦15,000/);
    assert.equal(mock.calls.filter(c => c.path.startsWith('/graph')).length, 0);  // nothing was posted
  } finally { await mock.close(); }
  const mock2 = await startMock({ publicDir: path.join(root, 'public'), products: { 'bullet-rechargeable': { price: 15000 } } });
  try {
    const posted = await publish(publishCfg(root, mock2), quiet);
    assert.ok(posted.some(r => r.platform === 'instagram' && r.ok));
  } finally { await mock2.close(); }
});

test('publisher holds a product post when the product is out of stock', async () => {
  const root = publishRoot({ slug: 'bullet-rechargeable', price: 15000 });
  const mock = await startMock({ publicDir: path.join(root, 'public'), products: { 'bullet-rechargeable': { price: 15000, availability: 'OutOfStock' } } });
  try {
    const r = await publish(publishCfg(root, mock), quiet);
    assert.match(r[0].note, /^held: .*OutOfStock/);
  } finally { await mock.close(); }
});

test('reads Instagram and Facebook results for recent posts and skips metrics Meta refuses', async () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, 'state', 'posted.json'), JSON.stringify({
    'test-hello': { instagram: { done: true, id: 'igtest', at: '2026-11-01T10:00:00Z' } },
    'car': { instagram: { done: true, id: 'ig1', at: '2026-11-02T18:30:00Z' }, facebook: { done: true, id: 'PAGE1_9', at: '2026-11-02T18:31:00Z' } },
    'reel': { facebook: { done: true, id: '777', at: '2026-11-04T18:31:00Z' } },
    'old': { instagram: { done: true, id: 'ig0', at: '2026-08-01T18:30:00Z' } },
  }));
  fs.writeFileSync(path.join(root, 'state', 'insights.json'), JSON.stringify({ old: { instagram: { fetched_at: '2026-09-01T00:00:00Z', reach: 99 } } }));
  const mock = await startMock({ publicDir: root });
  try {
    const cfg = loadConfig({ CONTENT_ROOT: root, NOW: '2026-11-14T07:13:00+01:00', GRAPH_BASE: mock.base + '/graph', META_PAGE_TOKEN: 'page-token' });
    const rows = await readInsights(cfg, quiet);
    assert.ok(rows.every(r => r.ok), JSON.stringify(rows));
    const saved = loadInsights(root);
    assert.equal(saved.car.instagram.reach, 10);
    assert.deepEqual(saved.car.instagram._not_available, ['views']);
    assert.deepEqual([saved.car.facebook.reactions, saved.car.facebook.shares], [7, 2]);
    assert.equal(saved.reel.facebook.likes, 5);
    assert.equal(saved.old.instagram.reach, 99);                     // older than 30 days: kept, not refetched
    assert.equal(saved['test-hello'], undefined);                    // test posts are ignored
  } finally { await mock.close(); }
});

test('falls back to the saved product snapshot when the shop can\'t be reached', async () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, 'state', 'products.json'), JSON.stringify({ fetched_at: '2026-10-31T06:13:00Z',
    products: { 'the-wand': { name: 'The Wand', price: 20000, inStock: true, availability: 'InStock' } } }));
  const mock = await startMock({ publicDir: root, products: { 'bullet-classic': { price: 10000 } } });
  try {
    const r = await fetchProducts(root, ['bullet-classic', 'the-wand'], { base: mock.base + '/shop' });
    assert.equal(r.from, 'snapshot of 2026-10-31T06:13:00Z');
    assert.equal(r.products['bullet-classic'].price, 10000);   // read live
    assert.equal(r.products['the-wand'].price, 20000);         // from the snapshot
    assert.deepEqual(r.failed, []);
  } finally { await mock.close(); }
});

test('saves a page as readable text without scripts, navigation or markup', async () => {
  const { pageText } = await import('../engine/site-snapshot.mjs');
  const html = '<html><nav>Shop Learn</nav><main><h1>The Bullet</h1><script>var x=1</script><p>Care: wipe clean &amp; store dry.</p><p>&#8358;15,000</p></main><footer>© Intimova</footer></html>';
  assert.equal(pageText(html), 'The Bullet\nCare: wipe clean & store dry.\n₦15,000');
});
