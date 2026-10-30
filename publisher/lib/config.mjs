// All settings come from environment variables (GitHub Actions secrets and variables).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function loadConfig(env = process.env) {
  return {
    root: env.CONTENT_ROOT || ROOT,
    dryRun: env.DRY_RUN === '1' || env.DRY_RUN === 'true',
    now: env.NOW ? new Date(env.NOW) : new Date(),
    onlyPost: env.ONLY_POST || '',            // post id to publish now, ignoring its time (manual run)
    rehearsal: env.REHEARSAL === '1' || env.REHEARSAL === 'true', // upload everything, publish nothing (needs ONLY_POST)
    maxLateHours: Number(env.MAX_LATE_HOURS || 12),
    maxAttempts: Number(env.MAX_ATTEMPTS || 3),
    platforms: (env.PLATFORMS || 'instagram,facebook').split(',').map(s => s.trim()).filter(Boolean),
    mediaBase: env.MEDIA_BASE_URL || '',      // e.g. https://media.intimova.ng
    shopBase: env.SHOP_BASE_URL || 'https://intimova.ng', // product pages, checked before a product post goes out
    pollMs: Number(env.POLL_MS || 10000),
    graph: {
      base: env.GRAPH_BASE || 'https://graph.facebook.com',
      rupload: env.RUPLOAD_BASE || 'https://rupload.facebook.com',
      video: env.GRAPH_VIDEO_BASE || 'https://graph-video.facebook.com', // Page video uploads (file bytes)
      version: env.GRAPH_VERSION || 'v26.0',
      pageId: env.META_PAGE_ID || '',
      pageToken: env.META_PAGE_TOKEN || '',
      igUserId: env.IG_USER_ID || '',
      igToken: env.META_IG_TOKEN || '',       // only if the Page token is refused for Instagram calls
    },
    x: {
      base: env.X_BASE || 'https://api.x.com',
      clientId: env.X_CLIENT_ID || '',
      clientSecret: env.X_CLIENT_SECRET || '',
    },
    tiktok: {
      base: env.TIKTOK_BASE || 'https://open.tiktokapis.com',
      clientKey: env.TIKTOK_CLIENT_KEY || '',
      clientSecret: env.TIKTOK_CLIENT_SECRET || '',
    },
    github: {
      api: env.GITHUB_API_URL || 'https://api.github.com',
      token: env.GITHUB_TOKEN || '',
      repo: env.GITHUB_REPOSITORY || '',        // owner/name, set by GitHub Actions
      notifyUser: env.NOTIFY_USER || '',        // tagged in TikTok and alert issues so GitHub notifies them
      event: env.GITHUB_EVENT_NAME || '',       // 'schedule' on GitHub's own clock: only those runs can tell the alarm is down
    },
    tokensKey: env.TOKENS_KEY || '',
    summaryFile: env.GITHUB_STEP_SUMMARY || '',
  };
}
