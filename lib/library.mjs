// The content library: what each weekly slot can draw on, what's been used, and how many weeks are left.
// A post marks what it used with "library": "<item id>" (or a list) in its post.json.
import fs from 'node:fs';
import path from 'node:path';
import { loadAllPosts } from './post.mjs';

export const SLOTS = [
  { day: 'Mon', key: 'myths', label: 'Myth vs fact' },
  { day: 'Tue', key: 'carousels', label: 'Education carousel' },
  { day: 'Wed', key: 'stories', label: 'Story reel' },
  { day: 'Fri', key: 'quotes-tips', label: 'Quote or tip' },
  { day: 'Sun', key: 'products', label: 'Product' },
];
export const LOW_WEEKS = 6;               // warn when a slot has fewer weeks left than this
export const PRODUCT_COOLDOWN_DAYS = 28;  // the same product at most once every 4 weeks
const STATUSES = ['ready', 'hold', 'used', 'website-only'];

export function loadLibrary(root) {
  const read = f => JSON.parse(fs.readFileSync(path.join(root, 'library', f), 'utf8'));
  return {
    sources: read('sources.json').sources,
    myths: read('myths.json').items,
    carousels: read('carousels.json').items,
    stories: read('stories.json').series,
    'quotes-tips': read('quotes-tips.json').items,
    products: read('products.json'),
  };
}

/** Story parts as flat items: id "<series>-<n>". */
export function storyParts(series) {
  return series.flatMap(s => s.parts.map(p => ({ ...p, id: `${s.id}-${p.n}`, series: s.id })));
}

/** Items for one slot, in library order. */
export function slotItems(lib, key) {
  if (key === 'stories') return storyParts(lib.stories);
  if (key === 'products') return lib.products.items;
  return lib[key];
}

/** Every library id that a post has used, mapped to the post: from posts' "library" field and items marked used. */
export function usedIds(root, lib) {
  const used = new Map();
  for (const post of loadAllPosts(root)) for (const id of [].concat(post.library || [])) used.set(id, post.id);
  for (const s of SLOTS) for (const it of slotItems(lib, s.key)) if (it.status === 'used') used.set(it.id, it.used_in || 'earlier');
  return used;
}

/** Problems that would make the library unreliable: bad references, duplicate ids, unknown statuses. */
export function validateLibrary(lib) {
  const e = [];
  const findings = new Set();
  const sourceIds = new Set();
  for (const s of lib.sources) {
    if (sourceIds.has(s.id)) e.push(`sources: duplicate id ${s.id}`);
    sourceIds.add(s.id);
    if (!/^https:\/\//.test(s.url || '')) e.push(`sources: ${s.id} needs an https url`);
    if (!s.cite || !s.country) e.push(`sources: ${s.id} needs cite and country`);
    for (const f of s.findings || []) findings.add(`${s.id}/${f.id}`);
  }
  const catalogue = lib.products.catalogue || {};
  const seen = new Map(); // ids are unique across every file, since a post's "library" id marks it used everywhere
  for (const slot of SLOTS) {
    for (const it of slotItems(lib, slot.key)) {
      const where = `${slot.key}: ${it.id}`;
      if (seen.has(it.id)) e.push(`${slot.key}: id ${it.id} is already used in ${seen.get(it.id)}`);
      seen.set(it.id, slot.key);
      if (!STATUSES.includes(it.status)) e.push(`${where} has unknown status "${it.status}"`);
      for (const f of it.facts || []) if (!findings.has(f)) e.push(`${where} cites ${f}, which isn't in sources.json`);
      if (slot.key === 'products') {
        if (!it.products?.length) e.push(`${where} lists no products`);
        for (const p of it.products || []) if (!catalogue[p]) e.push(`${where} features ${p}, which isn't in the catalogue`);
      }
      if (slot.key === 'carousels' && !/^https:\/\/intimova\.ng\/learn\//.test(it.article || '')) e.push(`${where} needs an intimova.ng/learn article`);
      if (slot.key === 'quotes-tips' && !['quote', 'tip'].includes(it.kind)) e.push(`${where} kind must be quote or tip`);
    }
  }
  return e;
}

/** Product slugs posted in the cooldown window before `date`, from posts' "product" field. */
function recentProducts(root, date) {
  const recent = new Set();
  for (const post of loadAllPosts(root)) {
    const t = Date.parse(post.publish_at);
    if (post.product?.slug && t < date.getTime() && date.getTime() - t < PRODUCT_COOLDOWN_DAYS * 86400e3) recent.add(post.product.slug);
  }
  return recent;
}

/**
 * Ready items per slot, weeks left, and the next pick for the week starting `weekStart` (a Monday).
 * `live` is optional { slug: { inStock } } from the product pages; out-of-stock products are skipped.
 */
export function runway(root, lib, { weekStart = new Date(), live = null } = {}) {
  const used = usedIds(root, lib);
  const catalogue = lib.products.catalogue || {};
  const sunday = new Date(weekStart.getTime() + 6 * 86400e3);
  const recent = recentProducts(root, sunday);
  const inStock = slug => !live || live[slug]?.inStock !== false;
  const lastFriday = lastKindUsed(root, lib);

  return SLOTS.map(slot => {
    let ready = slotItems(lib, slot.key).filter(it => it.status === 'ready' && !used.has(it.id));
    if (slot.key === 'products') ready = ready.filter(it => it.products.every(p => catalogue[p]?.status === 'ready' && inStock(p)));
    const held = slotItems(lib, slot.key).filter(it => it.status === 'hold').length;
    let candidates = ready;
    if (slot.key === 'products') {
      const day = sunday.toISOString().slice(0, 10);
      const inSeason = it => !it.season || (day >= it.season.from && day <= it.season.to);
      const seasonal = ready.filter(it => it.season && inSeason(it) && !recent.has(it.products[0]));
      candidates = seasonal.length ? seasonal : ready.filter(it => !it.season && !recent.has(it.products[0]));
    }
    if (slot.key === 'quotes-tips' && lastFriday) {
      const other = candidates.filter(it => it.kind !== lastFriday);
      if (other.length) candidates = other;
    }
    if (slot.key === 'stories') candidates = nextStoryPart(lib, used);
    const weeks = slot.key === 'products' ? ready.filter(it => !it.season).length + seasonWeeks(ready) : ready.length;
    return { ...slot, ready: ready.length, held, weeks, low: weeks < LOW_WEEKS, next: candidates[0] || null };
  });
}

// Seasonal items each fill at most one week of their own window.
const seasonWeeks = items => new Set(items.filter(it => it.season).map(it => it.season.from)).size;

/** The next story part: continue the series in progress, otherwise start the next series in order. */
function nextStoryPart(lib, used) {
  for (const s of lib.stories) {
    const next = storyParts([s]).find(p => !used.has(p.id) && p.status !== 'used');
    if (next) return next.status === 'ready' ? [next] : [];
  }
  return [];
}

/** "quote" or "tip": what the most recent Friday post used, so Fridays alternate. */
function lastKindUsed(root, lib) {
  const kinds = new Map(lib['quotes-tips'].map(it => [it.id, it.kind]));
  const posts = loadAllPosts(root).filter(p => [].concat(p.library || []).some(id => kinds.has(id)))
    .sort((a, b) => Date.parse(b.publish_at) - Date.parse(a.publish_at));
  if (posts.length) return kinds.get([].concat(posts[0].library).find(id => kinds.has(id)));
  const marked = lib['quotes-tips'].filter(it => it.status === 'used');
  return marked.length ? marked[marked.length - 1].kind : null;
}
