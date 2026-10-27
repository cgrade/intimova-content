# Handoff: where the Intimova pipeline stands (27 Oct 2026, evening)

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
- **Content library (`library/`):** about six months of material for five posts a week (Mon myth vs fact, Tue education carousel, Wed story, Fri quote or tip, Sun product). `npm run runway` shows weeks left per day; see `library/README.md`. From the week of 2 Nov the Saturday run drafts five posts a week from it.
- **Product checks:** product facts come from intimova.ng's public product pages (their schema.org data), read-only. A post with `"product"` is held by the publisher if the live price or stock no longer matches. Nothing in the marketplace repo was changed.
- **Results and prices:** the "Read post results and product prices" job (Saturdays 07:13 Lagos) saves Instagram and Facebook numbers to `state/insights.json` and product prices and stock to `state/products.json`. Claude's cloud sandbox can't reach intimova.ng, so the Saturday draft uses that snapshot; the publisher's own pre-post check runs on GitHub and reads the live shop. The results part hasn't run against the live Meta API yet: check its first run on 31 Oct.
- **This week (folder `content/2026-10-26`), all at 19:30 Lagos time:**
  - Mon 26: myth vs fact carousel
  - Wed 28: Lily part 1 reel, with its original score
  - Fri 30: quote card
  - Sun 1 Nov: product guide, waiting on Grade's product details (see `NEEDS-INPUT.md`)

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
- **Cloud runs (tested 27 Oct):** push works; pull requests and comments go through the built-in GitHub tools (`gh` can't); `bash scripts/cloud-setup.sh` sets up Python and Chromium, and rendering works after it; intimova.ng is blocked from the cloud (see the price snapshot above).

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
- **The week (from 2 Nov), five posts:**
  - Mon: myth vs fact
  - Tue: education carousel
  - Wed: story reel
  - Fri: quote card or couples tip, alternating
  - Sun: product

## Open items

1. Grade: the product details for the Sunday product guide (name, link, price, who it's for).
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
