// The posting alarm (alarm/worker.js): it must start the real publisher, never a dry run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { startPublisher } from '../alarm/worker.js';

function fakeGithub(status = 204, body = '') {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(body || null, { status }); };
  return { calls, fetchImpl };
}

test('alarm asks GitHub to run publish.yml on main, not as a dry run', async () => {
  const gh = fakeGithub(204);
  const status = await startPublisher({ GITHUB_TOKEN: 'tok', GITHUB_REPO: 'cgrade/intimova-content' }, gh.fetchImpl);
  assert.equal(status, 204);
  assert.equal(gh.calls.length, 1);
  const { url, init } = gh.calls[0];
  assert.equal(url, 'https://api.github.com/repos/cgrade/intimova-content/actions/workflows/publish.yml/dispatches');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer tok');
  assert.ok(init.headers['User-Agent']);
  assert.deepEqual(JSON.parse(init.body), { ref: 'main', inputs: { dry_run: 'false' } });
});

test('alarm accepts GitHub answering 200 with run details', async () => {
  const gh = fakeGithub(200, '{"workflow_run_id":1}');
  assert.equal(await startPublisher({ GITHUB_TOKEN: 'tok' }, gh.fetchImpl), 200);
});

test('alarm explains a refused or missing token', async () => {
  await assert.rejects(startPublisher({}, fakeGithub().fetchImpl), /GITHUB_TOKEN is not set/);
  await assert.rejects(startPublisher({ GITHUB_TOKEN: 'old' }, fakeGithub(401, 'Bad credentials').fetchImpl), /401.*expired/);
  await assert.rejects(startPublisher({ GITHUB_TOKEN: 'tok' }, fakeGithub(403, 'Resource not accessible').fetchImpl), /Read and write/);
});

test('the Worker has a scheduled handler and no public page', async () => {
  assert.equal(typeof worker.scheduled, 'function');
  assert.equal((await worker.fetch()).status, 404);
});
