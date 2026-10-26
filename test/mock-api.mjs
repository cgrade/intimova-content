// A fake Meta + X + TikTok API for tests. Records every call so tests can check what was sent.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export function startMock({ publicDir, failOnce = {} } = {}) {
  const calls = [];
  let n = 0;
  const fails = { ...failOnce };
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const u = new URL(req.url, 'http://x');
    const ct = req.headers['content-type'] || '';
    let body = {};
    if (ct.includes('json')) body = JSON.parse(raw.toString() || '{}');
    else if (ct.includes('x-www-form-urlencoded')) body = Object.fromEntries(new URLSearchParams(raw.toString()));
    else if (ct.includes('multipart')) body = { multipart: true, bytes: raw.length, segment: /name="segment_index"\r\n\r\n(\d+)/.exec(raw.toString('latin1'))?.[1] };
    const call = { method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: req.headers, body };
    calls.push(call);
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    const key = `${req.method} ${u.pathname}`;
    for (const [pat, times] of Object.entries(fails)) if (times > 0 && key.includes(pat)) { fails[pat]--; return send(500, { error: { message: 'simulated outage' } }); }
    const p = u.pathname;
    n++;

    if (p.startsWith('/media/')) {
      const f = path.join(publicDir, p.slice('/media/'.length));
      res.writeHead(fs.existsSync(f) ? 200 : 404); return res.end();
    }
    // Meta Graph
    let m;
    if ((m = p.match(/^\/graph\/v26\.0\/IG123\/media$/)) && req.method === 'POST') return send(200, { id: 'c' + n });
    if (p === '/graph/v26.0/IG123/media_publish') return send(200, { id: 'igpost' + n });
    if (p === '/graph/v26.0/PAGE1/photos') return send(200, { id: 'ph' + n, post_id: 'PAGE1_' + n });
    if (p === '/graph/v26.0/PAGE1/feed') return send(200, { id: 'PAGE1_feed' + n });
    if (p === '/graph/v26.0/PAGE1/video_reels') {
      if (body.upload_phase === 'start') return send(200, { video_id: 'v77', upload_url: 'https://rupload.example/v77' });
      if (body.upload_phase === 'finish') return send(200, { success: true });
      return send(400, { error: { message: 'bad phase' } });
    }
    if (p === '/graph/v26.0/oauth/access_token') return send(200, { access_token: 'long-user', token_type: 'bearer' });
    if (p === '/graph/v26.0/me/accounts') return send(200, { data: [{ id: 'PAGE1', name: 'Intimova', access_token: 'page-token' }] });
    if (p === '/graph/v26.0/PAGE1' && u.searchParams.get('fields') === 'instagram_business_account') return send(200, { instagram_business_account: { id: 'IG123' }, id: 'PAGE1' });
    if (p === '/graph/v26.0/IG123' && u.searchParams.get('fields') === 'username') return send(200, { username: 'intimova.ng', id: 'IG123' });
    if (p === '/x/2/oauth2/token' && body.grant_type === 'authorization_code') return send(200, { access_token: 'x-a', refresh_token: 'x-r', expires_in: 7200, scope: 'tweet.read tweet.write users.read media.write offline.access' });
    if (p === '/tiktok/v2/oauth/token/' && body.grant_type === 'authorization_code') return send(200, { access_token: 't-a', refresh_token: 't-r', expires_in: 86400, refresh_expires_in: 31536000, open_id: 'o1', scope: 'video.upload' });
    if ((m = p.match(/^\/graph\/v26\.0\/([^/]+)$/)) && req.method === 'GET') {
      if (u.searchParams.get('fields') === 'status_code') return send(200, { status_code: 'FINISHED', id: m[1] });
      if (u.searchParams.get('fields') === 'status') return send(200, { status: { video_status: 'upload_complete' } });
    }
    if (p === '/rupload/video-upload/v26.0/v77') {
      if (!req.headers.file_url || !String(req.headers.authorization).startsWith('OAuth ')) return send(400, { error: { message: 'missing headers' } });
      return send(200, { success: true });
    }
    // X
    if (p === '/x/2/oauth2/token') return send(200, { access_token: 'x-access-2', refresh_token: 'x-refresh-2', expires_in: 7200 });
    if (p === '/x/2/media/upload/initialize') return send(200, { data: { id: 'm' + n, media_category: body.media_category } });
    if ((m = p.match(/^\/x\/2\/media\/upload\/(m\d+)\/append$/))) return send(200, {});
    if ((m = p.match(/^\/x\/2\/media\/upload\/(m\d+)\/finalize$/))) {
      const isVideo = calls.find(c => c.path === '/x/2/media/upload/initialize' && c.body.media_category === 'tweet_video');
      return send(200, { data: { id: m[1], ...(isVideo ? { processing_info: { state: 'pending', check_after_secs: 1 } } : {}) } });
    }
    if (p === '/x/2/media/upload' && req.method === 'GET') return send(200, { data: { id: u.searchParams.get('media_id'), processing_info: { state: 'succeeded' } } });
    if (p === '/x/2/tweets') return send(200, { data: { id: 't' + n, text: body.text } });
    // TikTok
    if (p === '/tiktok/v2/oauth/token/') return send(200, { access_token: 'tt-access-2', refresh_token: 'tt-refresh-2', expires_in: 86400, refresh_expires_in: 31536000, open_id: 'o1' });
    if (p === '/tiktok/v2/post/publish/content/init/' || p === '/tiktok/v2/post/publish/inbox/video/init/') return send(200, { data: { publish_id: 'pub' + n }, error: { code: 'ok', message: '' } });
    if (p === '/tiktok/v2/post/publish/status/fetch/') return send(200, { data: { status: 'SEND_TO_USER_INBOX' }, error: { code: 'ok' } });
    send(404, { error: { message: 'mock: no route for ' + key } });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({ base, calls, close: () => new Promise(r => server.close(r)) });
  }));
}
