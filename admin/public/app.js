// Intimova admin, the phone app: three tabs (Week, Approve, TikTok) over the Worker's /api.
const view = document.getElementById('view');
const sub = document.getElementById('sub');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS = { posted: 'Posted', scheduled: 'Scheduled', due: 'Going out now', held: 'On hold', problem: 'Needs you' };
const PLAT = { posted: 'posted', failed: 'failed', held: 'on hold', scheduled: 'scheduled', missed: 'missed', due: 'due now', 'sent to you': 'sent to you' };
let tab = 'week', weekOffset = 0, cache = {};

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, { ...opts, headers: { 'x-intimova-admin': '1', ...(opts.body && { 'Content-Type': 'application/json' }) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function toast(msg) {
  const t = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
  document.body.append(t); setTimeout(() => t.remove(), 2600);
}
const fmtWeek = w => new Date(w + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const thumbOf = p => p.media[0] ? (p.media[0].kind === 'video' ? p.media[0].poster : p.media[0].url) : '';

function card(p, { today } = {}) {
  const st = p.status?.overall;
  const thumb = thumbOf(p);
  return `<button class="card${today ? ' today' : ''}" data-post="${esc(p.id)}">
    <div class="when"><div class="day">${esc(p.day)}</div><div class="time">${esc(p.time)}</div></div>
    <div class="thumb" style="${thumb ? `background-image:url('${esc(thumb)}')` : ''}">${p.format === 'reel' ? `<span class="play">▶ ${Math.round(p.media[0]?.duration || 0)}s</span>` : ''}</div>
    <div class="body"><div class="label">${esc(p.label)}</div><div class="hook">${esc(p.hook)}</div>
      ${st ? `<span class="pill ${esc(st)}">${esc(STATUS[st] || st)}</span>` : !p.rendered ? '<span class="pill problem">Not rendered</span>' : ''}</div>
  </button>`;
}

function openPost(p, { draft } = {}) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', p.label || p.id);
  const media = p.media.map(m => m.kind === 'video'
    ? `<video src="${esc(m.url)}" poster="${esc(m.poster)}" controls playsinline preload="metadata"></video>`
    : `<img src="${esc(m.url)}" alt="" loading="lazy">`).join('');
  const plats = p.status ? Object.entries(p.status.platforms).map(([k, v]) => `<span class="pill ${v === 'posted' || v === 'sent to you' ? 'posted' : v === 'failed' || v === 'missed' || v === 'held' ? 'problem' : 'scheduled'}">${esc(k)}: ${esc(PLAT[v] || v)}</span>`).join('') : '';
  sheet.innerHTML = `<div class="sheet-head"><button class="icon-btn" data-close aria-label="Back">‹</button>
      <div class="t"><div class="label">${esc(p.label)}</div><div class="sub">${esc(p.day)} ${esc(p.time)} · ${esc(p.format)}</div></div></div>
    <div class="sheet-body">
      ${media ? `<div class="slides">${media}</div>${p.media.length > 1 ? `<p class="count">${p.media.length} slides · swipe</p>` : ''}` : '<div class="empty">Not rendered yet.</div>'}
      ${plats ? `<h3>Where it stands</h3><div class="plats">${plats}</div>` : ''}
      <h3>Caption</h3><div class="caption">${esc(p.caption)}</div>
      ${p.product ? `<p class="sub">Product: ${esc(p.product.slug)} at ₦${Number(p.product.price).toLocaleString('en-NG')}. The publisher holds the post if the shop price changes.</p>` : ''}
      ${draft ? `<h3>Ask for a change</h3><textarea id="change" placeholder="What should change in this post?"></textarea>
        <button class="primary" id="send" style="margin-top:10px">Send to the Sunday run</button>
        <p class="sub">It's added to the pull request. The Sunday run (17:40) makes the change; after that, ask Claude directly.</p>` : ''}
    </div>`;
  document.body.append(sheet);
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  sheet.querySelector('#send')?.addEventListener('click', async e => {
    const text = sheet.querySelector('#change').value;
    e.target.disabled = true;
    try { await api(`/drafts/${draft.number}/comment`, { method: 'POST', body: JSON.stringify({ post: p.id, text }) }); toast('Sent. The Sunday run will make the change.'); sheet.remove(); }
    catch (err) { toast(err.message); e.target.disabled = false; }
  });
}

function confirmSheet(message, action) {
  const c = document.createElement('div');
  c.className = 'confirm';
  c.innerHTML = `<div role="alertdialog" aria-label="Confirm"><p>${message}</p><button class="primary" data-yes>Yes, approve</button><button class="secondary" data-no>Not yet</button></div>`;
  document.body.append(c);
  c.querySelector('[data-no]').onclick = () => c.remove();
  c.querySelector('[data-yes]').onclick = async e => { e.target.disabled = true; try { await action(); } finally { c.remove(); } };
}

async function showWeek() {
  sub.textContent = 'This week';
  const d = cache.week = await api(`/week?offset=${weekOffset}`);
  view.innerHTML = `<div class="weekbar"><button class="icon-btn" data-nav="-1" aria-label="Previous week">‹</button>
      <h2>Week of ${esc(fmtWeek(d.week))}</h2><button class="icon-btn" data-nav="1" aria-label="Next week" ${weekOffset >= 1 ? 'disabled' : ''}>›</button></div>
    ${d.posts.some(p => p.status.overall === 'problem') ? '<div class="error">Something needs you. Open the post marked “Needs you”; there\'s also a GitHub issue about it.</div>' : ''}
    ${d.posts.length ? d.posts.map(p => card(p, { today: weekOffset === 0 && p.day === d.today })).join('') : `<div class="empty">Nothing on main for this week${weekOffset === 1 ? ' yet. It arrives when you approve the draft.' : '.'}</div>`}`;
  view.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => { weekOffset += Number(b.dataset.nav); render(); });
  view.querySelectorAll('[data-post]').forEach(b => b.onclick = () => openPost(d.posts.find(p => p.id === b.dataset.post)));
}

async function showApprove() {
  sub.textContent = 'Approve next week';
  const d = cache.drafts = await api('/drafts');
  if (!d.drafts.length) { view.innerHTML = '<div class="empty">Nothing waiting for you. The Saturday run opens next week\'s draft at about 09:33.</div>'; return; }
  const dr = d.drafts[0];
  const missing = dr.posts.filter(p => !p.rendered).length;
  view.innerHTML = `<div class="weekbar"><h2>Week of ${esc(fmtWeek(dr.week))}</h2></div>
    <div class="notice">${dr.posts.length} post${dr.posts.length === 1 ? '' : 's'}. Tap one to see every slide and caption, or to ask for a change.</div>
    ${missing ? `<div class="error">${missing} post${missing === 1 ? ' isn\'t' : 's aren\'t'} rendered yet.</div>` : ''}
    ${dr.posts.map(p => card(p)).join('')}
    ${d.drafts.length > 1 ? `<div class="notice">${d.drafts.length - 1} more draft${d.drafts.length > 2 ? 's' : ''} open on GitHub.</div>` : ''}
    <div class="sticky"><div><button class="primary" id="approve">Approve the week</button></div></div>`;
  view.querySelectorAll('[data-post]').forEach(b => b.onclick = () => openPost(dr.posts.find(p => p.id === b.dataset.post), { draft: dr }));
  document.getElementById('approve').onclick = () => confirmSheet(
    `Approve the week of <b>${esc(fmtWeek(dr.week))}</b>? Its ${dr.posts.length} post${dr.posts.length === 1 ? '' : 's'} will go out at ${dr.posts.length === 1 ? 'its time' : 'their times'}. (This merges pull request #${dr.number}.)`,
    async () => {
      try { const r = await api(`/drafts/${dr.number}/approve`, { method: 'POST', body: JSON.stringify({ sha: dr.sha }) }); toast(r.merged ? 'Approved. The week is scheduled.' : r.message || 'Not merged'); render(); }
      catch (err) { toast(/409|Head branch was modified/i.test(err.message) ? 'The draft changed since you opened it. Look again, then approve.' : err.message); render(); }
    });
}

async function showTiktok() {
  sub.textContent = 'Post to TikTok';
  const d = cache.tiktok = await api('/tiktok');
  setBadge('tiktok', d.items.length);
  if (!d.items.length) { view.innerHTML = '<div class="empty">Nothing to post on TikTok right now. Each post appears here at its time.</div>'; return; }
  view.innerHTML = d.items.map(it => {
    const p = it.post;
    if (!p) return `<div class="card"><div class="body"><div class="hook">${esc(it.title)}</div><a href="${esc(it.url)}">Open on GitHub</a></div></div>`;
    const files = p.media.map((m, i) => `<a class="secondary" style="text-align:center;line-height:48px;text-decoration:none" href="/api/file?url=${encodeURIComponent(m.url)}">${m.kind === 'video' ? 'Save the video' : `Save slide ${i + 1}`}</a>`).join('');
    return `<section style="margin-bottom:22px">${card(p)}
      ${files}
      ${p.format !== 'reel' ? `<div class="row"><button class="secondary" data-copy="${esc(p.tiktok.title)}">Copy title</button><button class="secondary" data-copy="${esc(p.tiktok.caption)}">Copy caption</button></div>`
        : `<button class="secondary" data-copy="${esc(p.tiktok.caption)}">Copy caption</button>`}
      <button class="primary" data-done="${it.issue}" style="margin-top:10px">I've posted it</button></section>`;
  }).join('');
  view.querySelectorAll('[data-post]').forEach(b => b.onclick = () => openPost(d.items.find(i => i.post?.id === b.dataset.post).post));
  view.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied'); } catch { toast('Copy failed: press and hold the caption on the post instead'); } });
  view.querySelectorAll('[data-done]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { await api(`/tiktok/${b.dataset.done}/done`, { method: 'POST' }); toast('Marked as posted'); render(); }
    catch (err) { toast(err.message); b.disabled = false; }
  });
}

function setBadge(name, n) { const b = document.getElementById('badge-' + name); b.hidden = !n; b.textContent = n || ''; }

async function render() {
  document.querySelectorAll('nav.tabs button').forEach(b => b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  view.innerHTML = '<div class="spinner">Loading…</div>';
  try { await ({ week: showWeek, approve: showApprove, tiktok: showTiktok })[tab](); }
  catch (err) { view.innerHTML = `<div class="error">Couldn't load this: ${esc(err.message)}</div><button class="secondary" id="retry">Try again</button>`; document.getElementById('retry').onclick = render; }
}

document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
render();
// Badges for the other tabs, so Grade sees at a glance if anything waits.
api('/drafts').then(d => setBadge('approve', d.drafts.length)).catch(() => {});
api('/tiktok').then(d => setBadge('tiktok', d.items.length)).catch(() => {});
