// Small fetch wrapper: JSON or form bodies, clear errors, one retry on 429/5xx.
export class ApiError extends Error {
  // The URL is kept redacted: a crash prints the whole error, and the Actions logs of this public repo can be read by anyone.
  constructor(message, { status, body, url } = {}) { super(message); this.status = status; this.body = body; this.url = url === undefined ? url : redact(url); }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function request(method, url, { json, form, body, headers = {}, retries = 1 } = {}) {
  const h = { ...headers };
  let payload = body;
  if (json !== undefined) { payload = JSON.stringify(json); h['Content-Type'] ??= 'application/json; charset=UTF-8'; }
  else if (form !== undefined) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) if (v !== undefined && v !== null) p.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    payload = p.toString(); h['Content-Type'] ??= 'application/x-www-form-urlencoded';
  }
  for (let attempt = 0; ; attempt++) {
    let res;
    try { res = await fetch(url, { method, headers: h, body: payload }); }
    catch (e) { if (attempt < retries) { await sleep(2000); continue; } throw new ApiError(`Network error calling ${redact(url)}: ${e.message}`, { url }); }
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (res.ok) return data;
    if ((res.status === 429 || res.status >= 500) && attempt < retries) { await sleep(3000 * (attempt + 1)); continue; }
    throw new ApiError(`${method} ${redact(url)} failed with ${res.status}: ${summarize(data)}`, { status: res.status, body: data, url });
  }
}

export async function head(url) {
  try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch { return false; }
}

// Any query parameter whose name mentions a token, secret, password or key (fb_exchange_token, client_secret, ...).
export function redact(url) { return String(url).replace(/([?&][^=&]*(?:token|secret|password|key)[^=&]*)=[^&]*/gi, '$1=***'); }
function summarize(d) {
  const e = d?.error ?? d?.errors ?? d;
  return JSON.stringify(e).slice(0, 500);
}
export { sleep };
