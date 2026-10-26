// Helpers for the one-time setup scripts you run on your own computer.
import readline from 'node:readline/promises';
import { ROOT } from '../lib/config.mjs';
import { loadTokens, saveTokens } from '../lib/store.mjs';

export function need(names) {
  const missing = names.filter(n => !process.env[n]);
  if (missing.length) {
    console.error(`Set these first (in your terminal, not in any file you commit):\n  ${missing.map(n => `export ${n}=...`).join('\n  ')}`);
    process.exit(1);
  }
  return Object.fromEntries(names.map(n => [n, process.env[n]]));
}
export async function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(q);
  rl.close();
  return a.trim();
}
/** Reads ?code= from the address you were redirected to, and checks state. */
export function codeFrom(pasted, expectedState) {
  const u = new URL(pasted);
  const err = u.searchParams.get('error');
  if (err) throw new Error(`Authorization refused: ${err} ${u.searchParams.get('error_description') || ''}`);
  if (expectedState && u.searchParams.get('state') !== expectedState) throw new Error('State did not match. Start again.');
  const code = u.searchParams.get('code');
  if (!code) throw new Error('No code in that address. Paste the full address from the browser bar after you approved.');
  return code;
}
export function mergeTokens(part) {
  const key = process.env.TOKENS_KEY;
  const all = loadTokens(ROOT, key);
  Object.assign(all, part);
  saveTokens(ROOT, all, key);
  console.log('\nSaved to state/tokens.enc (encrypted). Commit and push that file.');
}
