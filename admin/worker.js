// Intimova admin: a private, phone-first page for the three things Grade does every week.
//   Week     this week's posts and whether each went out
//   Approve  next week's draft, with real previews: approve it (merges the pull request) or ask for a change
//   TikTok   today's hand-posted TikToks: save the files, copy the caption, mark it posted
// GitHub stays the source of truth: this page only reads the repo and calls GitHub's API.
//
// Who can open it: Cloudflare Access, enabled on this Worker in the dashboard. Every signed-in request
// carries ctx.access; without it the Worker refuses everything (it fails closed), assets included.
//
// Secrets and vars (see admin/README.md): GITHUB_TOKEN, a fine-grained token for cgrade/intimova-content
// with Contents: read and write, Pull requests: read, Issues: read and write. Optional ALLOWED_EMAILS.

const API = 'https://api.github.com';
const DAY = 24 * 3600 * 1000;
const LAGOS = 3600 * 1000;            // UTC+1 all year
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default {
  async fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
};

export async function handle(request, env, ctx, fetchImpl = fetch) {
  // Cloudflare Access must have run, or nothing is served. This is the only door.
  if (!ctx?.access) return text('Sign in through Cloudflare Access to open this page.', 401);
  if (env.ALLOWED_EMAILS) {
    const who = (await ctx.access.getIdentity())?.email?.toLowerCase();
    const allowed = env.ALLOWED_EMAILS.toLowerCase().split(',').map(s => s.trim());
    if (!who || !allowed.includes(who)) return text('This account is not allowed here.', 403);
  }
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
  // Changes need a header other websites can't send, so a link elsewhere can't approve a week.
  if (request.method !== 'GET' && request.headers.get('x-intimova-admin') !== '1') return json({ error: 'missing x-intimova-admin header' }, 400);
  if (!env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN is not set: run npx wrangler secret put GITHUB_TOKEN in admin/' }, 500);
  const gh = github(env, fetchImpl);
  try {
    let m;
    if (url.pathname === '/api/week' && request.method === 'GET') return json(await weekView(gh, env, new Date(), Number(url.searchParams.get('offset') || 0)));
    if (url.pathname === '/api/drafts' && request.method === 'GET') return json(await draftsView(gh, env));
    if ((m = url.pathname.match(/^\/api\/drafts\/(\d+)\/approve$/)) && request.method === 'POST') return json(await approve(gh, Number(m[1]), await request.json()));
    if ((m = url.pathname.match(/^\/api\/drafts\/(\d+)\/comment$/)) && request.method === 'POST') return json(await comment(gh, Number(m[1]), await request.json()));
    if (url.pathname === '/api/tiktok' && request.method === 'GET') return json(await tiktokView(gh, env));
    if ((m = url.pathname.match(/^\/api\/tiktok\/(\d+)\/done$/)) && request.method === 'POST') return json(await tiktokDone(gh, Number(m[1])));
    if (url.pathname === '/api/file' && request.method === 'GET') return download(url.searchParams.get('url'), env, fetchImpl);
    return json({ error: 'not found' }, 404);
  } catch (e) {
    return json({ error: e.message }, e.status && e.status < 500 ? e.status : 502);
  }
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const text = (s, status) => new Response(s, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

/** A small GitHub client for one repository. */
function github(env, fetchImpl) {
  const repo = env.GITHUB_REPO || 'cgrade/intimova-content';
  const call = async (method, path, body, accept = 'application/vnd.github+json') => {
    const res = await fetchImpl(`${API}/repos/${repo}${path}`, {
      method,
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'intimova-admin', ...(body && { 'Content-Type': 'application/json' }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) {
      const why = (await res.text()).slice(0, 300);
      const err = new Error(`GitHub ${method} ${path} returned ${res.status}: ${why}`);
      err.status = res.status === 401 || res.status === 403 ? 502 : res.status;
      throw err;
    }
    return res.status === 204 ? {} : accept.endsWith('raw') ? res.text() : res.json();
  };
  return {
    repo,
    call,
    raw: async (path, ref) => {
      const t = await call('GET', `/contents/${path}?ref=${encodeURIComponent(ref)}`, null, 'application/vnd.github.raw');
      return t === null ? null : JSON.parse(t);
    },
    list: async (path, ref) => (await call('GET', `/contents/${path}?ref=${encodeURIComponent(ref)}`)) || [],
  };
}

/** Monday 00:00 Lagos of the week containing `date`, plus `offset` weeks, as YYYY-MM-DD. */
export function mondayOf(date, offset = 0) {
  const l = new Date(date.getTime() + LAGOS);
  const back = (l.getUTCDay() + 6) % 7;
  return new Date(Date.parse(l.toISOString().slice(0, 10) + 'T00:00:00Z') - back * DAY + offset * 7 * DAY).toISOString().slice(0, 10);
}

/** Every post in content/<week> at a ref, with its manifest and the URLs its files are served at. */
async function weekPosts(gh, env, week, ref) {
  const dirs = (await gh.list(`content/${week}`, ref)).filter(d => d.type === 'dir');
  const posts = await Promise.all(dirs.map(async d => {
    const [post, manifest] = await Promise.all([gh.raw(`content/${week}/${d.name}/post.json`, ref), gh.raw(`public/${week}/${d.name}/manifest.json`, ref)]);
    if (!post) return null;
    // On main the media host serves the files; a draft branch isn't deployed yet, so its files come from GitHub.
    const base = ref === 'main' && env.MEDIA_BASE ? `${env.MEDIA_BASE}/${week}/${d.name}` : `https://raw.githubusercontent.com/${gh.repo}/${ref}/public/${week}/${d.name}`;
    const big = manifest?.hosted === false;
    const file = f => (big && f === manifest.video ? `https://raw.githubusercontent.com/${gh.repo}/${ref}/public/${week}/${d.name}` : base) + '/' + f;
    return summarise(post, manifest, file, d.name);
  }));
  return posts.filter(Boolean).sort((a, b) => a.publish_at.localeCompare(b.publish_at));
}

/** What the page shows for one post. Words come only from post.json; nothing is invented here. */
export function summarise(post, manifest, file, folder) {
  const t = new Date(Date.parse(post.publish_at) + LAGOS);
  const s = post.slides || [];
  const first = s[0] || {};
  const lines = (post.story?.scenes || []).flatMap(sc => sc.lines || []).map(l => l.text);
  const hook = post.format === 'reel' ? lines.slice(0, 2).join(' ') : first.headline || first.text || first.quote || first.question || '';
  const label = post.series || post.series_label || (s.length === 1 && first.type === 'quote' ? 'Quote' : post.pillar) || '';
  return {
    id: post.id, folder, format: post.format, publish_at: post.publish_at, hold: !!post.hold, library: post.library || null,
    day: DAYS[t.getUTCDay()], time: t.toISOString().slice(11, 16), label, hook: hook.replace(/\*/g, ''),
    caption: post.captions?.instagram || '', tiktok: { title: post.captions?.tiktok_title || '', caption: post.captions?.tiktok || '' },
    platforms: post.platforms || [], product: post.product || null,
    rendered: !!manifest,
    media: !manifest ? [] : manifest.type === 'reel'
      ? [{ kind: 'video', url: file(manifest.video), poster: file(manifest.cover), duration: manifest.duration }]
      : manifest.images.map(f => ({ kind: 'image', url: file(f) })),
  };
}

/** Where each platform stands for a post, from state/posted.json. */
export function statusOf(p, state, now) {
  const st = state[p.id] || {};
  const due = Date.parse(p.publish_at);
  const plats = {};
  for (const pl of ['instagram', 'facebook']) {
    if (!p.platforms.includes(pl)) continue;
    const s = st[pl] || {};
    plats[pl] = s.done ? 'posted' : s.gave_up ? 'failed' : p.hold ? 'held' : now < due ? 'scheduled' : now - due > 12 * 3600 * 1000 ? 'missed' : 'due';
  }
  if (p.platforms.includes('tiktok')) {
    const m = st.tiktok_manual;
    plats.tiktok = m?.notified ? 'sent to you' : p.hold ? 'held' : now < due ? 'scheduled' : 'due';
  }
  const all = Object.values(plats);
  const overall = all.includes('failed') || all.includes('missed') ? 'problem' : p.hold ? 'held'
    : all.every(v => v === 'posted' || v === 'sent to you') ? 'posted' : all.includes('due') ? 'due' : 'scheduled';
  return { overall, platforms: plats };
}

async function weekView(gh, env, now, offset) {
  const week = mondayOf(now, offset);
  const [posts, state] = await Promise.all([weekPosts(gh, env, week, 'main'), gh.raw('state/posted.json', 'main')]);
  return { week, offset, today: DAYS[new Date(now.getTime() + LAGOS).getUTCDay()], posts: posts.map(p => ({ ...p, status: statusOf(p, state || {}, now.getTime()) })) };
}

async function draftsView(gh, env) {
  const prs = (await gh.call('GET', '/pulls?state=open&per_page=20')) || [];
  const weeks = prs.filter(pr => /^week\/\d{4}-\d{2}-\d{2}$/.test(pr.head.ref));
  return { drafts: await Promise.all(weeks.map(async pr => {
    const week = pr.head.ref.slice(5);
    return { number: pr.number, title: pr.title, url: pr.html_url, week, sha: pr.head.sha, posts: await weekPosts(gh, env, week, pr.head.ref) };
  })) };
}

/** Approve = merge the week's pull request, only if it is still the version Grade looked at. */
async function approve(gh, number, { sha }) {
  if (!sha) throw Object.assign(new Error('sha is required, so an approval can only merge the version you saw'), { status: 400 });
  const pr = await gh.call('GET', `/pulls/${number}`);
  if (!pr || !/^week\//.test(pr.head.ref)) throw Object.assign(new Error('Only week pull requests can be approved here.'), { status: 400 });
  const r = await gh.call('PUT', `/pulls/${number}/merge`, { sha, merge_method: 'merge', commit_title: `Approve ${pr.title} (#${number})` });
  return { merged: !!r.merged, message: r.message };
}

/** A change request lands as a comment on the pull request, where the Sunday run picks it up. */
async function comment(gh, number, { post, text: body }) {
  if (!body?.trim()) throw Object.assign(new Error('Write what to change.'), { status: 400 });
  const pr = await gh.call('GET', `/pulls/${number}`);
  if (!pr || !/^week\//.test(pr.head.ref)) throw Object.assign(new Error('Only week pull requests take comments here.'), { status: 400 });
  const c = await gh.call('POST', `/issues/${number}/comments`, { body: `${post ? `**${post}**: ` : ''}${body.trim()}\n\n_(from the admin page)_` });
  return { ok: true, url: c.html_url };
}

/** Open "Post to TikTok" issues, matched to their posts through state/posted.json. */
async function tiktokView(gh, env) {
  const [issues, state] = await Promise.all([gh.call('GET', '/issues?state=open&per_page=50'), gh.raw('state/posted.json', 'main')]);
  const open = (issues || []).filter(i => !i.pull_request && /^Post to TikTok/.test(i.title));
  const byIssue = new Map(Object.entries(state || {}).filter(([, v]) => v.tiktok_manual?.issue).map(([id, v]) => [v.tiktok_manual.issue, id]));
  const weeks = new Map();
  const items = [];
  for (const i of open) {
    const id = byIssue.get(i.number);
    const week = id?.match(/^(\d{4}-\d{2}-\d{2})/) && mondayOf(new Date(id.slice(0, 10) + 'T12:00:00Z'));
    if (week && !weeks.has(week)) weeks.set(week, await weekPosts(gh, env, week, 'main'));
    const post = week ? weeks.get(week).find(p => p.id === id) : null;
    items.push({ issue: i.number, title: i.title, url: i.html_url, created_at: i.created_at, post });
  }
  return { items: items.sort((a, b) => a.created_at.localeCompare(b.created_at)) };
}

async function tiktokDone(gh, number) {
  const i = await gh.call('GET', `/issues/${number}`);
  if (!i || !/^Post to TikTok/.test(i.title)) throw Object.assign(new Error('Only TikTok issues can be marked posted here.'), { status: 400 });
  await gh.call('PATCH', `/issues/${number}`, { state: 'closed', state_reason: 'completed' });
  return { ok: true };
}

/** Streams a media file back with a download header, so the phone saves it instead of opening it. Only our own files. */
async function download(target, env, fetchImpl) {
  let u;
  try { u = new URL(target); } catch { return json({ error: 'bad url' }, 400); }
  const repo = env.GITHUB_REPO || 'cgrade/intimova-content';
  const ok = (env.MEDIA_BASE && target.startsWith(env.MEDIA_BASE + '/')) || (u.origin === 'https://raw.githubusercontent.com' && u.pathname.startsWith(`/${repo}/`));
  if (!ok || !/\.(jpg|mp4)$/.test(u.pathname)) return json({ error: 'not one of our files' }, 400);
  const res = await fetchImpl(u.href);
  if (!res.ok) return json({ error: `file returned ${res.status}` }, 502);
  const name = u.pathname.split('/').slice(-2).join('-');
  return new Response(res.body, { headers: { 'Content-Type': res.headers.get('content-type') || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, max-age=300' } });
}
