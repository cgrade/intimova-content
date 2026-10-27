# Handoff: where the Intimova pipeline stands (26 Oct 2026, evening)

This file lets a new Claude Code session, in your editor or the terminal, pick up the work without the original chat.
Read it with `CLAUDE.md`. `CLAUDE.md` holds the standing rules for the weekly runs; this file is the state of things.

## What exists

- **Repo** `cgrade/intimova-content` (public). It holds the content, the rendered media in `public/`, the reel and carousel engine in `engine/`, and the publisher in `publisher/`. See `README.md` for setup and the folder map.
- **Media hosting:** Cloudflare (Workers static assets, via `wrangler.jsonc`) serves `public/` at `MEDIA_BASE_URL`.
- **Posting:** the GitHub Actions job "Publish due posts" runs every 10 minutes from 06:03 to 22:53 Lagos time (GitHub delays or drops scheduled runs under load, so it runs often).
  - It posts what's due to **Instagram and Facebook**. Tested live on 26 Oct with `test-hello`; see `state/posted.json` for the IDs.
  - For **TikTok**, it opens a GitHub issue that tags Grade, with the file links and caption, and he posts by hand. TikTok's app review rules out apps that only post to your own account and apps for adult products, so TikTok isn't automated.
  - **X** isn't connected (no credit or app yet). `PLATFORMS` is `instagram,facebook`.
- **GitHub secrets set:** `META_PAGE_ID`, `IG_USER_ID`, `META_PAGE_TOKEN`. **Variables:** `MEDIA_BASE_URL`, `PLATFORMS`.
  - The Page token was pasted into a chat once, so it should be regenerated after the first live posts, then the secret updated.
- **This week (folder `content/2026-10-26`), all at 19:30 Lagos time:**
  - Mon 26: myth vs fact carousel
  - Wed 28: Lily part 1 reel, with its original score
  - Fri 30: quote card
  - Sun 1 Nov: product guide for The Bullet (rechargeable), ₦15,000. Details come from intimova.ng/product/bullet-rechargeable as of 27 Oct. Check the price is still the same before it posts.

## The reel engine

- Each story reel gets animated words over a moving satin background (`engine/reel/stage.html`, `satin.py`) and an original score (`engine/reel/score.py`). All are timed from cues in `post.json`. The cue meanings are in `CLAUDE.md`.
- **The score follows the research**, not "special frequencies":
  - Tempo drives arousal: 56 bpm when calm, up to about 100 bpm through the heat.
  - A heartbeat enters with the longing.
  - A surprise chord and a new instrument at the emotional turn.
  - A slow build, brightness and an endlessly rising tone to the peak.
  - Hard silence at the reveal.
  - The bass and heartbeat carry harmonics so they play on phone speakers.
  - There are deliberately no 432 Hz or binaural tricks (weak evidence; binaural needs headphones).
- **Reels must stay under 89.5 s,** because Facebook Reels allow 90 s. The engine speeds up by at most about 4% to fit, or refuses.
- **Carousels:** slide types are cover, myth, fact, text, takeaway and quote. They render 1080×1350 JPEG.
- **Brand:**
  - wine `#6B0F3A`, cream `#FAF3EC`, near-black `#12070D`
  - Playfair Display and Inter
  - stories sit on dark backgrounds, education on cream

## Weekly automation (Claude cloud scheduled tasks on Grade's account)

- **"Intimova weekly content draft":** Saturdays 09:33 Lagos. It drafts the first Monday with no folder in `content/` (31 Oct drafts the week of 2 Nov, with Lily part 2 on Wednesday), renders it, and opens a pull request for Grade to approve by merging.
- **"Intimova Sunday fixes":** Sundays 17:40 Lagos. It applies Grade's pull request comments.
- **Blocker:** as of 26 Oct the Claude GitHub connection can read this repo but **can't push** (error 403). Until Grade reconnects GitHub in claude.ai settings, the weekly runs can't open pull requests, so they send him the files instead. Changes made outside this repo's GitHub flow have gone to Grade as `git am` patches.

## Content rules (summary; the full playbook is a Claude Doc)

- **Playbook:** https://claude.ai/artifact/5zjobeTQXa7s2NYd5M7Uw1
- **Pipeline plan:** https://claude.ai/artifact/JysPkaahaLMbyybpCCcZtx
- **Stories** read like romance novels, at above-medium heat, carried by the words.
  - Never explicit, and no anatomical or crude words.
  - Adults only, with mutual consent.
  - She chooses herself by the end of a series.
- **Health facts:**
  - a named source on the slide, and the country the data comes from
  - never "cures", "treats" or "prevents"
  - "a link, not proof" for observational studies
- **Captions:** X posts under 280 characters and without links. Instagram allows up to 2,200 characters and 30 hashtags.
- **Starter week:**
  - Mon: fact or myth-buster
  - Wed: story reel
  - Fri: quote card or couples tip
  - Sun: product guide

## Open items

1. Product guides: take the details from intimova.ng/shop (each product page lists price, materials, care, delivery and returns). Use only what the page states; it doesn't mention Paystack.
2. Grade: reconnect GitHub so Claude can push (needed for the Saturday run on 31 Oct).
3. Grade: regenerate the Meta Page token and update the secret.
4. Optional: connect X (README step 5). This needs pay-per-use credit.
5. Optional later: Instagram's Audio API can attach a track from Instagram's own library to Reels at publish time. It's untested with the Page token we use, and Facebook has no equivalent.
6. Check after each Lily reel: listen on a phone speaker. The score was checked by measurement only, never by ear.

## Running things locally

```
npm install
npx playwright install chromium     # the browser Playwright renders with
pip install numpy scipy pillow      # for the background and the score
npm run render -- content/<week>    # needs ffmpeg on PATH
node engine/validate.mjs
npm test
```
