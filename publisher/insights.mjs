// Reads how each post did on Instagram and Facebook and saves it to state/insights.json,
// so the Saturday run can see which topics and formats work. Run weekly by GitHub Actions.
// Only posts from the last 30 days are refreshed; older numbers are kept as they were.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { loadState } from './lib/store.mjs';
import { request } from './lib/http.mjs';

const IG_METRICS = ['reach', 'views', 'saved', 'shares', 'likes', 'comments', 'total_interactions'];
const REFRESH_DAYS = 30;

const insightsFile = root => path.join(root, 'state', 'insights.json');
export function loadInsights(root) {
  const f = insightsFile(root);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}

/** Instagram media insights. Asks for all metrics at once; if Meta refuses one, asks one by one and skips those it refuses. */
async function instagramInsights(cfg, mediaId) {
  const g = cfg.graph;
  const token = encodeURIComponent(g.igToken || g.insightsToken || g.pageToken);
  const api = `${g.base}/${g.version}`;
  const parse = r => Object.fromEntries((r.data || []).map(d => [d.name, d.values?.[0]?.value ?? d.total_value?.value ?? null]));
  try {
    return parse(await request('GET', `${api}/${mediaId}/insights?metric=${IG_METRICS.join(',')}&access_token=${token}`));
  } catch {
    const out = {}; const refused = []; let why = '';
    for (const m of IG_METRICS) {
      try { Object.assign(out, parse(await request('GET', `${api}/${mediaId}/insights?metric=${m}&access_token=${token}`, { retries: 0 }))); }
      catch (e) { refused.push(m); why ||= e.message.replace(/access_token=[^&\s"]+/g, 'access_token=***'); }
    }
    // Keep Meta's own reason: a missing permission (#10) looks very different from a metric it no longer offers.
    if (!Object.keys(out).length) throw new Error(`Instagram refused every metric for ${mediaId}. Meta said: ${why}`);
    if (refused.length) out._not_available = refused;
    return out;
  }
}

/**
 * Facebook engagement from the object's own fields (no extra permission beyond the Page token).
 * Photo and feed posts are saved as PAGEID_POSTID; reels are saved as a bare video id, which has likes instead of reactions.
 */
async function facebookInsights(cfg, id) {
  const g = cfg.graph;
  const isVideo = !id.includes('_');
  const fields = isVideo
    ? 'likes.summary(total_count).limit(0),comments.summary(total_count).limit(0)'
    : 'shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)';
  const r = await request('GET', `${g.base}/${g.version}/${id}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(g.insightsToken || g.pageToken)}`);
  const count = k => r[k]?.summary?.total_count ?? null;
  return isVideo ? { likes: count('likes'), comments: count('comments') } : { reactions: count('reactions'), comments: count('comments'), shares: r.shares?.count ?? 0 };
}

export async function run(cfg = loadConfig(), log = console.log) {
  const state = loadState(cfg.root);
  const insights = loadInsights(cfg.root);
  const now = cfg.now.getTime();
  const rows = [];
  for (const [postId, platforms] of Object.entries(state)) {
    if (postId.startsWith('test-')) continue;
    for (const [plat, fetcher] of [['instagram', instagramInsights], ['facebook', facebookInsights]]) {
      const s = platforms[plat];
      if (!s?.done || !s.id) continue;
      const age = (now - Date.parse(s.at)) / 86400e3;
      const prev = insights[postId]?.[plat];
      if (prev?.fetched_at && age > REFRESH_DAYS) continue;
      try {
        const metrics = await fetcher(cfg, s.id);
        (insights[postId] ||= {})[plat] = { fetched_at: cfg.now.toISOString(), days_after_posting: Math.round(age), ...metrics };
        rows.push({ postId, plat, ok: true, metrics });
        log(`✓ ${postId} · ${plat}: ${Object.entries(metrics).filter(([k]) => !k.startsWith('_')).map(([k, v]) => `${k} ${v}`).join(', ')}`);
      } catch (e) {
        rows.push({ postId, plat, ok: false, note: e.message });
        log(`✗ ${postId} · ${plat}: ${e.message}`);
      }
    }
  }
  if (!cfg.dryRun) fs.writeFileSync(insightsFile(cfg.root), JSON.stringify(insights, null, 2) + '\n');
  if (cfg.summaryFile) {
    const lines = ['## Intimova post results', '', '| Post | Platform | Result |', '| --- | --- | --- |',
      ...rows.map(r => `| ${r.postId} | ${r.plat} | ${r.ok ? Object.entries(r.metrics).filter(([k]) => !k.startsWith('_')).map(([k, v]) => `${k} ${v}`).join(', ') : '❌ ' + r.note} |`)];
    fs.appendFileSync(cfg.summaryFile, lines.join('\n') + '\n');
  }
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rows = await run();
  process.exit(rows.length && rows.every(r => !r.ok) ? 1 : 0);
}
