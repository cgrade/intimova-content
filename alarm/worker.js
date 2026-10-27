// The posting alarm: a Cloudflare Worker that starts Intimova's GitHub jobs on time.
//
// GitHub's own schedule is delayed, and sometimes dropped, when GitHub is busy. Cloudflare's
// cron triggers fire on time, so this Worker asks GitHub to run (see wrangler.jsonc):
// - "Publish due posts" every 10 minutes through the day. Starting it when nothing is due is
//   harmless: it checks, finds nothing, and stops. Posts are never made twice.
// - "Read post results and product prices" on Saturday morning, before the 09:33 draft run,
//   which needs the fresh product snapshot. Running it twice is harmless too.
//
// Needs one secret, GITHUB_TOKEN: a fine-grained GitHub token for cgrade/intimova-content
// with the "Actions" repository permission set to "Read and write". Nothing else.

const API = 'https://api.github.com';

/** Which GitHub job a cron trigger starts. Any cron other than INSIGHTS_CRON starts the publisher. */
export function jobFor(cron, env) {
  if (env.INSIGHTS_CRON && cron === env.INSIGHTS_CRON) return { workflow: 'insights.yml', inputs: undefined, name: 'the Saturday results and prices job' };
  return { workflow: env.WORKFLOW || 'publish.yml', inputs: { dry_run: 'false' }, name: 'the publisher' };
}

export default {
  async scheduled(controller, env, ctx) {
    const job = jobFor(controller.cron, env);
    ctx.waitUntil(startWorkflow(env, job.workflow, job.inputs).then(
      status => console.log(`Started ${job.name} (GitHub said ${status})`),
      err => { console.error(err.message); throw err; }));
  },
  // No public page: this Worker only runs on its schedule.
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};

/** Asks GitHub to run publish.yml on main for real (not a dry run). Returns GitHub's status code. */
export function startPublisher(env, fetchImpl = fetch) {
  return startWorkflow(env, env.WORKFLOW || 'publish.yml', { dry_run: 'false' }, fetchImpl);
}

/** Asks GitHub to run a workflow on main. Returns GitHub's status code. */
export async function startWorkflow(env, workflow, inputs, fetchImpl = fetch) {
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not set. Add it with: npx wrangler secret put GITHUB_TOKEN');
  const repo = env.GITHUB_REPO || 'cgrade/intimova-content';
  const res = await fetchImpl(`${API}/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'intimova-alarm', // GitHub's API refuses requests without one
    },
    // The publisher's dry_run input defaults to true, so the alarm must say false.
    // Jobs without inputs get none: GitHub refuses inputs a workflow doesn't declare.
    body: JSON.stringify(inputs ? { ref: 'main', inputs } : { ref: 'main' }),
  });
  if (!res.ok) {
    const why = (await res.text()).slice(0, 300);
    const hint = res.status === 401 ? ' The token is wrong or has expired: make a new one and run npx wrangler secret put GITHUB_TOKEN.'
      : res.status === 403 || res.status === 404 ? ' The token needs access to this repository with Actions set to "Read and write".'
      : '';
    throw new Error(`GitHub refused to start ${workflow}: ${res.status} ${why}${hint}`);
  }
  return res.status;
}
