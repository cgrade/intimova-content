// The posting alarm: a Cloudflare Worker that starts the "Publish due posts" GitHub job.
//
// GitHub's own schedule is delayed, and sometimes dropped, when GitHub is busy. Cloudflare's
// cron triggers fire on time, so this Worker asks GitHub to run the job every 10 minutes
// through the day (see wrangler.jsonc). Starting the job when nothing is due is harmless:
// it checks, finds nothing, and stops. Posts are never made twice.
//
// Needs one secret, GITHUB_TOKEN: a fine-grained GitHub token for cgrade/intimova-content
// with the "Actions" repository permission set to "Read and write". Nothing else.

const API = 'https://api.github.com';

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(startPublisher(env).then(
      status => console.log(`Started the publisher (GitHub said ${status})`),
      err => { console.error(err.message); throw err; }));
  },
  // No public page: this Worker only runs on its schedule.
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};

/** Asks GitHub to run publish.yml on main for real (not a dry run). Returns GitHub's status code. */
export async function startPublisher(env, fetchImpl = fetch) {
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not set. Add it with: npx wrangler secret put GITHUB_TOKEN');
  const repo = env.GITHUB_REPO || 'cgrade/intimova-content';
  const workflow = env.WORKFLOW || 'publish.yml';
  const res = await fetchImpl(`${API}/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'intimova-alarm', // GitHub's API refuses requests without one
    },
    // The workflow's dry_run input defaults to true, so the alarm must say false.
    body: JSON.stringify({ ref: 'main', inputs: { dry_run: 'false' } }),
  });
  if (!res.ok) {
    const why = (await res.text()).slice(0, 300);
    const hint = res.status === 401 ? ' The token is wrong or has expired: make a new one and run npx wrangler secret put GITHUB_TOKEN.'
      : res.status === 403 || res.status === 404 ? ' The token needs access to this repository with Actions set to "Read and write".'
      : '';
    throw new Error(`GitHub refused to start the publisher: ${res.status} ${why}${hint}`);
  }
  return res.status;
}
