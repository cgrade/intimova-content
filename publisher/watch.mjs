// Tells Grade, through one GitHub issue each, when something needs him: a post that was held, broken,
// given up on or missed; the posting alarm going quiet; or next week's posts not drafted or not approved.
// Each alert is raised once (state/alerts.json remembers it), however many runs see the same problem.
import fs from 'node:fs';
import path from 'node:path';
import { request } from './lib/http.mjs';

const HOUR = 3600 * 1000;
const LAGOS = HOUR;                 // Lagos is UTC+1 all year (no daylight saving)
const ALARM_QUIET_HOURS = 2;        // the alarm starts the publisher every 10 minutes, so 2 hours of nothing means it's down
const RECENT_DAYS = 7;              // only look this far back for missed posts, so old history never alerts

export function loadAlerts(root) {
  const f = path.join(root, 'state', 'alerts.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}
function saveAlerts(root, alerts) {
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, 'state', 'alerts.json'), JSON.stringify(alerts, null, 2) + '\n');
}

/** Lagos wall-clock parts of a time: day of week (0 = Sunday), hour, and the YYYY-MM-DD date. */
export function lagos(date) {
  const d = new Date(date.getTime() + LAGOS);
  return { day: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), date: d.toISOString().slice(0, 10) };
}

/** The Monday after a Lagos Saturday or Sunday, as YYYY-MM-DD. */
export function nextMonday(date) {
  const l = lagos(date);
  const ahead = l.day === 6 ? 2 : l.day === 0 ? 1 : (8 - l.day) % 7 || 7;
  return new Date(Date.parse(l.date + 'T00:00:00Z') + ahead * 24 * HOUR).toISOString().slice(0, 10);
}

/** Problems with posts, from this run's results and the saved state. Pure: no network. */
export function postAlerts({ results, posts, state, cfg }) {
  const out = [];
  for (const r of results) {
    if (r.ok || r.waiting || r.dry || r.platform !== '-') continue;
    const held = /^held: /.test(r.note || '');
    out.push(held
      ? { key: `held:${r.post}`, title: `Held: ${r.post} did not post`, body: [`The publisher held **${r.post}** instead of posting it:`, '', `> ${r.note.replace(/^held: /, '')}`, '', 'Fix the post on main (for example the price on the slides and `product.price`), or set `"hold": true` to drop it. It keeps trying every 10 minutes for 12 hours after its time.'] }
      : { key: `broken:${r.post}`, title: `Broken: ${r.post} can't post`, body: [`**${r.post}** is due but can't be posted:`, '', `> ${r.note}`, '', 'Fix it on main; the publisher keeps trying every 10 minutes for 12 hours after its time.'] });
  }
  for (const [id, plats] of Object.entries(state)) {
    for (const [plat, s] of Object.entries(plats || {})) {
      if (!s?.gave_up) continue;
      out.push({ key: `failed:${id}:${plat}`, title: `Failed: ${id} on ${plat}`,
        body: [`The publisher gave up posting **${id}** to **${plat}** after ${s.attempts} tries. The last error:`, '', '```', String(s.error || 'unknown').slice(0, 1500), '```', '', 'Post it by hand, or fix the cause and run "Publish due posts" with Dry run unticked and `only_post` set to this id.'] });
    }
  }
  const now = cfg.now.getTime();
  for (const post of posts) {
    if (post.hold || post._week === 'test') continue;
    const t = Date.parse(post.publish_at);
    if (!(now - t > cfg.maxLateHours * HOUR && now - t < RECENT_DAYS * 24 * HOUR)) continue;
    const missing = post.platforms.filter(p => cfg.platforms.includes(p) && !(state[post.id]?.[p]?.done || state[post.id]?.[p]?.gave_up));
    if (missing.length) out.push({ key: `missed:${post.id}`, title: `Missed: ${post.id} never posted`,
      body: [`**${post.id}** was due at ${post.publish_at} and still hasn't gone to ${missing.join(' and ')}. The publisher stops trying ${cfg.maxLateHours} hours after a post's time.`, '', 'If the alarm was down, check its token (see the alarm alert, if any). To post it now: run "Publish due posts" with Dry run unticked and `only_post` set to this id.'] });
  }
  return out;
}

const gh = cfg => ({ Authorization: `Bearer ${cfg.github.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });

/** The alarm and next week's draft. Talks to GitHub; returns alerts. */
export async function watchdogAlerts(cfg) {
  const out = [];
  const l = lagos(cfg.now);
  const api = `${cfg.github.api}/repos/${cfg.github.repo}`;

  // The alarm: only GitHub's own schedule can notice it's gone quiet, because the alarm starts every other run.
  // From 09:00 only: the alarm's first run of the day is 06:01, so earlier the overnight gap would look like an outage.
  if (cfg.github.event === 'schedule' && l.hour >= 9 && l.hour < 23) {
    const r = await request('GET', `${api}/actions/workflows/publish.yml/runs?event=workflow_dispatch&per_page=1`, { headers: gh(cfg), retries: 1 });
    const last = r.workflow_runs?.[0]?.created_at;
    if (!last || cfg.now.getTime() - Date.parse(last) > ALARM_QUIET_HOURS * HOUR) {
      out.push({ key: `alarm:${l.date}`, title: 'The posting alarm has gone quiet',
        body: [`The Cloudflare alarm normally starts "Publish due posts" every 10 minutes, but the last run it started was ${last ? `at ${last}` : 'never'}. Until it's back, posts depend on GitHub's own schedule, which runs only a few times a day.`, '',
          'Most likely its GitHub token has expired. Make a new fine-grained token (this repository, Actions: Read and write), then in `alarm/` run `npx wrangler secret put GITHUB_TOKEN`. README step 8 has the details.'] });
    }
  }

  // Next week: drafted by Saturday afternoon, approved (merged) by Sunday evening.
  const draftDue = (l.day === 6 && l.hour >= 13) || l.day === 0;
  if (draftDue) {
    const monday = nextMonday(cfg.now);
    const onMain = fs.existsSync(path.join(cfg.root, 'content', monday));
    if (!onMain) {
      const owner = cfg.github.repo.split('/')[0];
      const prs = await request('GET', `${api}/pulls?state=open&head=${encodeURIComponent(`${owner}:week/${monday}`)}`, { headers: gh(cfg), retries: 1 });
      const pr = Array.isArray(prs) ? prs[0] : null;
      if (!pr) out.push({ key: `draft:${monday}`, title: `No draft yet for the week of ${monday}`,
        body: [`It's past Saturday 13:00 and there's no open pull request for the week of ${monday}, and nothing for that week on main. The Saturday draft run (09:33 Lagos) may have failed.`, '',
          'Check its run at https://claude.ai/code/routines, or ask Claude to draft the week. Monday\'s post goes out at 19:30 only if the week is merged by then.'] });
      else if (l.day === 0 && l.hour >= 20) out.push({ key: `approve:${monday}`, title: `Approve the week of ${monday}: merge #${pr.number}`,
        body: [`The week of ${monday} is drafted but not merged yet: ${pr.html_url}`, '', 'Nothing in it posts until it\'s merged. Monday\'s post is due at 19:30 Lagos.'] });
    }
  }
  return out;
}

/** Opens one issue per new alert, tagging Grade, and remembers it. Returns the alerts it opened. */
export async function raiseAlerts(cfg, alerts, log = console.log) {
  if (!alerts.length || !cfg.github.token || !cfg.github.repo) return [];
  const seen = loadAlerts(cfg.root);
  const opened = [];
  for (const a of alerts) {
    if (seen[a.key]) continue;
    const who = cfg.github.notifyUser ? `@${cfg.github.notifyUser} ` : '';
    try {
      const issue = await request('POST', `${cfg.github.api}/repos/${cfg.github.repo}/issues`, {
        headers: gh(cfg), json: { title: a.title, body: [`${who}${a.body[0]}`, ...a.body.slice(1)].join('\n') }, retries: 1 });
      seen[a.key] = { issue: issue.number, at: cfg.now.toISOString() };
      opened.push({ ...a, issue: issue.number });
      log(`⚠ alert: ${a.title} (issue #${issue.number})`);
    } catch (e) { log(`✗ couldn't open the alert "${a.title}": ${e.message}`); }
  }
  if (opened.length) saveAlerts(cfg.root, seen);
  return opened;
}
