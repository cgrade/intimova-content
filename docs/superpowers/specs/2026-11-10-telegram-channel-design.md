# Telegram channel: design (10 Nov 2026)

Agreed with Grade in chat on 10 Nov 2026. WhatsApp is out of scope for now; sound for carousels is a separate, later project.

## Goal

Every Intimova post also goes to Grade's public Telegram channel at its normal time, automatically. A one-off backfill sends five earlier posts so new subscribers can catch up.

## Facts this rests on (Telegram Bot API docs, read 10 Nov 2026)

- `chat_id` can be the channel's `@username`. The bot must be a channel admin allowed to post.
- Photo and video captions: 0–1024 characters. Text messages: 1–4096.
- `sendMediaGroup` sends an album of 2–10 items.
- Files uploaded with multipart/form-data: up to 10 MB per photo, 50 MB for other files. (By URL: 5 MB and 20 MB.)
- `disable_notification` sends a message silently. `supports_streaming` marks a video as suitable for streaming.

## Design

### Publisher (`publisher/platforms/telegram.mjs`)

- One slide → `sendPhoto`. 2–10 slides → `sendMediaGroup` with the caption on the first photo. Reel → `sendVideo` with `supports_streaming` and the cover as `thumbnail`.
- All media is uploaded as bytes from the checkout (`public/`), never by URL, so it doesn't wait for the media host.
- Caption: `post.captions.facebook` (no hashtags, has the full link). If it is over 1024 characters, the media gets the first paragraph and the full text follows as a `sendMessage` reply.
- Records the message id in `state/posted.json` under `telegram`, with the same no-repost, 3-tries and give-up rules as the other platforms.
- Rehearsal skips Telegram (Telegram has no upload-without-publishing), and says so in the log.

### Settings

- Secret `TELEGRAM_BOT_TOKEN`; variable `TELEGRAM_CHAT_ID` (`@username`); `PLATFORMS` includes `telegram`. (Grade set all three on 10 Nov.)
- `TELEGRAM_BASE` (default `https://api.telegram.org`) so tests can point at the mock.
- `lib/post.mjs` accepts `telegram` in `platforms` and checks it has `captions.facebook`.

### Which posts

- Posts that list `"telegram"` in `platforms`. This change adds it to the week of 9 Nov's posts from Tue 10 Nov onwards; from the week of 16 Nov the Saturday draft lists it on every post (CLAUDE.md updated).
- Not inferred from `facebook`: that would make the watchdog raise "Missed" alerts for every recent post that never went to Telegram.

### Backfill

- New `backfill` input on "Publish due posts": a comma-separated list of post ids. Sends those posts to Telegram only, oldest first, ~30 s apart, silently except the last. Skips any already recorded as sent. Product posts go through the live price and stock check first and are held, with the reason, if they no longer match.
- Grade's list: `2026-10-26-myth-toys`, `2026-10-28-lily-part1`, `2026-11-03-carousel-delivery`, `2026-11-04-lily-part2`, `2026-11-08-guide-rose`.
- Dry run first shows what it would send.

### Helper

- `npm run telegram:check`: with `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` set, calls `getMe` and `getChat` and reports whether the bot can post there (`getChatMember` for the bot, `can_post_messages`). Never prints the token. Also available as a workflow "Check Telegram" button so it runs with the GitHub secrets.

## Testing

Mock Telegram endpoints in `test/mock-api.mjs`. Tests: single photo, album, reel; caption overflow; no repost on a second run; retry then success; give-up alert; backfill sends Telegram only, in order, silent except last, holds a changed product; validation accepts `telegram`.

## Rollout

1. Merge. 2. Run "Check Telegram". 3. Backfill as a dry run, then for real. 4. Wednesday's Lily part 3 is the first scheduled Telegram post (Tuesday's too if merged before 07:30 Wednesday, within the 12-hour window).
