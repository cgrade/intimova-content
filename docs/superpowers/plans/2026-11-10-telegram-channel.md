# Telegram Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The publisher posts every post that lists `telegram` to Grade's public Telegram channel at its time, and a one-off `backfill` run sends chosen earlier posts there.

**Architecture:** A fourth poster, `publisher/platforms/telegram.mjs`, plugs into `POSTERS` in `publisher/publish.mjs` and uploads files as multipart to the Bot API. Backfill is a mode of the same `run()`, chosen by a `BACKFILL` env var. A small check script and workflow confirm the bot can post.

**Tech Stack:** Node 22 (built-in `fetch`, `FormData`, `Blob`, `node:test`), GitHub Actions. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-10-telegram-channel-design.md`

## Global Constraints

- Bot API base `https://api.telegram.org`, calls are `POST {base}/bot{token}/{method}`.
- Captions: `post.captions.facebook`, plain text, no `parse_mode`. Media caption ≤ 1024; text message ≤ 4096; album 2–10 items.
- Upload every file as bytes (multipart), never by URL.
- The bot token must never appear in logs, errors or `state/`.
- `chat_id` comes from `TELEGRAM_CHAT_ID` (e.g. `@intimova`).
- Backfill ids (Grade): `2026-10-26-myth-toys, 2026-10-28-lily-part1, 2026-11-03-carousel-delivery, 2026-11-04-lily-part2, 2026-11-08-guide-rose`.

## Review Focus

1. A failed Telegram call prints its URL, which holds the bot token in the path → must print `bot***` (Task 1).
2. A caption over 1024 characters → media posts with the first paragraph (cut at a word to ≤1024) and the full text follows as a reply, never a failed post (Task 3).
3. Telegram answers `{ok:false}` with HTTP 400/403 (bot not admin, wrong chat) → recorded as an error with Telegram's `description`, retried up to 3 runs, then a "Failed" alert (Task 3).
4. A backfill id that doesn't exist, or one already sent → named in the log and results, nothing else posted twice (Task 4).
5. Backfill must never post to Instagram or Facebook, even though those posts list them (Task 4).

---

### Task 1: Redact the bot token in URLs

**Files:** Modify `publisher/lib/http.mjs` (`redact`). Test: `test/publisher.test.mjs`.

- [ ] **Step 1: Failing test** `telegram bot tokens in a URL path are redacted`:
  `assert.equal(redact('https://api.telegram.org/bot123456:AAH-x_y/sendPhoto'), 'https://api.telegram.org/bot***/sendPhoto')`, and an `ApiError` built with that url has `bot***` in `.url`.
- [ ] **Step 2:** `npm test` → that test fails.
- [ ] **Step 3:** In `redact`, also replace `/bot[^/]+/` with `/bot***/`.
- [ ] **Step 4:** `npm test` → all pass.
- [ ] **Step 5:** Commit `Never print the Telegram bot token`.

### Task 2: Settings and validation

**Files:** Modify `publisher/lib/config.mjs`, `lib/post.mjs`. Test: `test/publisher.test.mjs`.

**Produces:** `cfg.telegram = { base, token, chatId }` from `TELEGRAM_BASE` (default `https://api.telegram.org`), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`; `cfg.backfill: string[]` from `BACKFILL` (comma-separated, trimmed, empty → `[]`); `cfg.backfillGapMs` from `BACKFILL_GAP_MS` (default 30000). `PLATFORMS` in `lib/post.mjs` includes `'telegram'`.

- [ ] **Step 1: Failing tests** `validation accepts telegram and needs the Facebook caption`: `validatePost(base({ platforms: ['telegram'], slides:[…] }))` → `[]`; with `captions: { instagram: 'ig' }` and `platforms: ['telegram']` → includes `'missing captions.facebook (Telegram uses it)'`. And `loadConfig({ BACKFILL: ' a, b ,' }).backfill` deep-equals `['a','b']`.
- [ ] **Step 2:** `npm test` → fails.
- [ ] **Step 3:** Implement; in `validatePost`, `telegram` checks `c.facebook`, not `c.telegram`.
- [ ] **Step 4:** `npm test` → all pass.
- [ ] **Step 5:** Commit `Telegram settings, and posts may list telegram`.

### Task 3: The Telegram poster

**Files:** Create `publisher/platforms/telegram.mjs`. Modify `publisher/publish.mjs` (POSTERS, live check, rehearsal), `test/mock-api.mjs` (routes `/tg/bot{token}/{method}`). Test: `test/publisher.test.mjs`.

**Consumes:** `cfg.telegram` (Task 2). **Produces:** `export async function postTelegram({ post, manifest, local, cfg, log, silent = false }) → { id: string }` (the first message id); `export function splitCaption(text: string): { caption: string, rest: string | null }`.

Mock: records multipart calls (method from the path, plain fields, file field names); answers `{ ok: true, result: { message_id: n } }` (an array of such for `sendMediaGroup`); `failOnce` works on `sendPhoto` etc.; a `tgReject` option answers 403 `{ ok:false, error_code:403, description:'Forbidden: bot is not a member of the channel chat' }`.

- [ ] **Step 1: Failing tests:**
  - `telegram: single slide is one photo, a carousel is one album, a reel is one video, each once` — with `PLATFORMS` including `telegram` and posts listing it: single → one `sendPhoto` with `caption: 'fb'`, `chat_id` set, a file field, no `parse_mode`; carousel (5 slides) → one `sendMediaGroup` whose `media` JSON has 5 `{type:'photo', media:'attach://pN'}` and `caption` only on item 0; reel → one `sendVideo` with `supports_streaming: 'true'`, a `video` file and `cover: 'attach://cover'`. State has `telegram.done` and `id`. A second `run` makes no Telegram calls.
  - `telegram: no media-host check` — with the media host returning 404, Telegram still posts (Instagram waits).
  - `splitCaption keeps captions up to 1024 and splits longer ones` — 1024 chars → `{caption: same, rest: null}`; two paragraphs of 700 → `caption` = first paragraph, `rest` = whole text; one 1500-char paragraph → `caption` ≤ 1024 ending at a word boundary with `…`, `rest` = whole text.
  - `telegram: a long caption is followed by the full text as a reply` — `sendMessage` called once with `text` = full caption and `reply_parameters` = `{"message_id":…}` of the media message.
  - `telegram: a refusal is retried and then raises a Failed alert` — with `tgReject`, three runs → `gave_up: true`, error contains `bot is not a member` and not the token.
  - `rehearsal skips telegram` — rehearsal of one post makes no `/tg/` calls and logs `telegram: skipped in rehearsal`.
- [ ] **Step 2:** `npm test` → those fail.
- [ ] **Step 3:** Implement. Multipart via `FormData` + `new Blob([fs.readFileSync(local(f))])`; send with `request('POST', url, { body: form, retries: 1 })`; `silent` sets `disable_notification: 'true'`. In `publish.mjs`: add to `POSTERS`; skip `ensureLive` for `telegram` (like `x`); in rehearsal, log the skip and `continue`.
- [ ] **Step 4:** `npm test` → all pass.
- [ ] **Step 5:** Commit `Post to the Telegram channel`.

### Task 4: Backfill

**Files:** Modify `publisher/publish.mjs`, `.github/workflows/publish.yml` (input `backfill`, env `BACKFILL`, `TELEGRAM_*` env from secrets/vars). Test: `test/publisher.test.mjs`.

**Consumes:** `postTelegram(..., silent)`, `cfg.backfill`, `cfg.backfillGapMs`.

Behaviour: when `cfg.backfill.length`, `run()` ignores times, holds and `post.platforms`; takes exactly those ids, sorted by `publish_at`; for each, runs the existing product check, then posts to `telegram` only with `silent = (not the last one)`, records it in state as usual, and sleeps `backfillGapMs` between posts. Unknown id → result `{ ok:false, note:'no such post' }`. Already-done → logged `= telegram: already posted`. Dry run lists what it would send. Rehearsal + backfill → refused.

- [ ] **Step 1: Failing tests** (`BACKFILL_GAP_MS: '0'`):
  - `backfill sends only to telegram, oldest first, silent except the last` — ids given out of order; `/tg/` calls in `publish_at` order; `disable_notification` `'true'` on all but the last; zero `/graph/` posting calls; state has `telegram.done` for each.
  - `backfill skips ones already sent and names unknown ids` — second run: no `/tg/` calls; `nope` → result note `no such post`.
  - `backfill holds a product post whose price changed` — mock shop price differs → no Telegram call for it, note starts `held:`.
  - `backfill dry run posts nothing`.
- [ ] **Step 2:** `npm test` → fail.
- [ ] **Step 3:** Implement; workflow input `backfill` (string, description `Post ids to send to Telegram only, now (comma-separated)`).
- [ ] **Step 4:** `npm test` → all pass.
- [ ] **Step 5:** Commit `Backfill: send chosen earlier posts to Telegram`.

### Task 5: Check Telegram

**Files:** Create `publisher/setup/telegram-check.mjs`, `.github/workflows/telegram-check.yml` (workflow_dispatch, runs it with the secret and variable). Modify `package.json` (`"telegram:check"`). Test: `test/publisher.test.mjs`.

**Produces:** `export async function checkTelegram(cfg) → { ok: boolean, lines: string[] }`. Calls `getMe`, `getChat` (`chat_id`), `getChatMember` (`chat_id`, `user_id` = bot id). `ok` only if the bot's status is `administrator` with `can_post_messages: true` (or `creator`). Lines name the bot's username, the channel title, and what's missing; never the token.

- [ ] **Step 1: Failing tests** `telegram check passes for an admin that can post, and says what's wrong otherwise` — mock answers admin → `ok: true`; member → `ok: false`, a line contains `make the bot an admin with "Post messages"`; output never contains the token.
- [ ] **Step 2:** `npm test` → fail.
- [ ] **Step 3:** Implement; the CLI prints `lines` and exits 1 when not ok.
- [ ] **Step 4:** `npm test` → all pass.
- [ ] **Step 5:** Commit `Check Telegram: confirm the bot can post to the channel`.

### Task 6: Turn it on for this week, and the docs

**Files:** Modify the 6 `post.json` files in `content/2026-11-09/` from `2-tue-…` to `7-sun-…` (append `"telegram"` to `platforms`); `CLAUDE.md` (posts list `telegram`; Telegram uses the Facebook caption); `README.md` (Telegram setup step: BotFather, admin with Post messages, secret, variables, Check Telegram, backfill); `HANDOFF.md` (Telegram live; fix the "Instagram Audio API" line: the API can't attach library music).

- [ ] **Step 1:** Edit the files. Only add `telegram` to Tuesday's `2-tue-carousel-body-safe` if this merges before Wed 11 Nov 07:30 Lagos (its 12-hour window); otherwise the watchdog would raise a "Missed" alert for it, so leave it out and tell Grade it can go in a backfill.
- [ ] **Step 2:** `node engine/validate.mjs` → every post `✓`, and the six list `telegram`. `npm test` → all pass.
- [ ] **Step 3:** Commit `Telegram from 10 Nov; docs`.
- [ ] **Step 4:** Push `feat/telegram` and open a pull request with the rollout steps from the spec.
