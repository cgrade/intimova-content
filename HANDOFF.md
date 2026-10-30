# Handoff: where the Intimova pipeline stands (27 Oct 2026, evening)

This file lets a new Claude Code session, in your editor or the terminal, pick up the work without the original chat.
Read it with `CLAUDE.md`. `CLAUDE.md` holds the standing rules for the weekly runs; this file is the state of things.

## What exists

- **Repo** `cgrade/intimova-content` (public). It holds the content, the rendered media in `public/`, the reel and carousel engine in `engine/`, and the publisher in `publisher/`. See `README.md` for setup and the folder map.
- **Media hosting:** Cloudflare (Workers static assets, via `wrangler.jsonc`) serves `public/` at `MEDIA_BASE_URL`.
- **Posting:** the GitHub Actions job "Publish due posts" posts whatever is due.
  - **Main clock:** the Cloudflare Worker `intimova-alarm` (`alarm/`) starts it every 10 minutes from 06:08 to 22:58 Lagos time, through GitHub's workflow-dispatch API, with a fine-grained token (Actions: read and write) stored as the Worker secret `GITHUB_TOKEN`. It also starts "Read post results and product prices" on Saturdays at 06:06 and 08:06. Grade deploys it (README step 8).
  - **Backup clock:** GitHub's own schedule at :03, :13 … It is unreliable: on 26–27 Oct GitHub started 4 of the 20-plus runs due.
  - Runs queue one at a time (`concurrency: publisher`) and check out the newest `main`, so a run that waited behind another sees what that run posted and doesn't repost it.
  - A post that no run picks up within 12 hours of its time is skipped (`maxLateHours`).
  - It posts what's due to **Instagram and Facebook**. Tested live on 26 Oct with `test-hello`; see `state/posted.json` for the IDs.
  - Facebook reels are uploaded as bytes from the checkout, not as a link. On 28 Oct Facebook refused the link to Lily part 1 ("Restricted by robots.txt") because Cloudflare's managed robots.txt on intimova.ng blocks `meta-externalagent`. Facebook photos and Instagram still go by link and worked.
  - An error Meta marks `"retriable": false` gives up after one try instead of three.
  - For **TikTok**, it opens a GitHub issue that tags Grade, with the file links and caption, and he posts by hand. TikTok's app review rules out apps that only post to your own account and apps for adult products, so TikTok isn't automated.
  - **X** isn't connected (no credit or app yet). `PLATFORMS` is `instagram,facebook`.
- **GitHub secrets set:** `META_PAGE_ID`, `IG_USER_ID`, `META_PAGE_TOKEN`. **Variables:** `MEDIA_BASE_URL`, `PLATFORMS`.
  - The Page token was pasted into a chat once, so it should be regenerated after the first live posts, then the secret updated.
- **Content library (`library/`):** material for seven posts a week, one a day (Mon myth buster, Tue education carousel, Wed story, Thu Ask Intimova, Fri quote, Sat tip, Sun product); from 30 Oct the first audience is young adults who want pleasure but hide it out of shame. `npm run runway` shows weeks left per day; see `library/README.md`. From the week of 2 Nov the Saturday run drafts five posts a week from it.
- **Product checks:** product facts come from intimova.ng's public product pages (their schema.org data), read-only. A post with `"product"` is held by the publisher if the live price or stock no longer matches. Nothing in the marketplace repo was changed.
- **Results and prices:** the "Read post results and product prices" job (Saturdays 07:13 Lagos) saves Instagram and Facebook numbers to `state/insights.json` and product prices and stock to `state/products.json`. Claude's cloud sandbox can't reach intimova.ng, so the Saturday draft uses that snapshot; the publisher's own pre-post check runs on GitHub and reads the live shop. The results part hasn't run against the live Meta API yet: check its first run on 31 Oct.
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
- **Story reels run 2 min 53 s to 3 minutes (173–179.5 s),** from Lily part 2 on; Lily part 1 was 89 s. 173 s is Grade's floor (30 Oct): the renderer refuses anything shorter, before it renders frames. Lily part 2 (596 words, 21 scenes) came to 173.9 s at normal pace, so aim for about 600 words. Above 179.5 s the engine speeds up a little to fit, or refuses.
  - Instagram shows Reels of up to 3 minutes in the Reels tab. Facebook Reels stop at 90 s, so longer reels go to Facebook as a Page video (`/videos`, the file's bytes).
  - A reel over 24 MB can't be served by Cloudflare (25 MiB per file). The renderer marks it `"hosted": false` and lists it in `public/.assetsignore`; Instagram then gets the file's bytes (resumable upload), and the TikTok issue links to the file on GitHub.
  - **Render time:** a 168 s test reel took 44 minutes on Grade's 4-core Mac (13 of them for the text frames, which render in parallel, one browser per worker). Reels over 90 s are encoded straight at CRF 25, which fit that test reel in 17.9 MB; shorter ones try CRF 20 first.
  - **Rehearsal:** run "Publish due posts" by hand with Dry run unticked, Rehearsal ticked and `only_post` set. It uploads to Instagram and Facebook for real but publishes nothing and records nothing. On Facebook, a reel of 90 s or less stops before the Reels "finish" step, so nothing appears anywhere; a reel over 90 s is uploaded as an unpublished Page video, which you can delete in Meta Business Suite afterwards. The Instagram container expires by itself.
- **Carousels:** slide types are cover, myth, fact, text, takeaway and quote. They render 1080×1350 JPEG.
- **Brand:**
  - wine `#6B0F3A`, cream `#FAF3EC`, near-black `#12070D`
  - Playfair Display and Inter
  - stories sit on dark backgrounds, education on cream

## Weekly automation (Claude cloud scheduled tasks on Grade's account)

- **"Intimova weekly draft (Saturday)"** (`trig_01LVP5w5KfqmuEmvyRFRshuP`): Saturdays 09:33 Lagos. It drafts five posts from `library/` for the first Monday with no folder in `content/` (31 Oct drafts the week of 2 Nov, with Lily part 2 on Wednesday), renders them, and opens a pull request for Grade to approve by merging. It stops and asks Grade to merge the library pull request (#3) if that isn't on main yet.
- **"Intimova Sunday fixes (cloud)"** (`trig_01N2yTr36RUKEF1tki4bM7Se`): Sundays 17:40 Lagos. It applies Grade's pull request comments, and can release or retire held library items when he says so.
- Both were created on 27 Oct as standard cloud routines (environment "Default"). The two older routines ("Intimova weekly content draft", "Intimova Sunday fixes") are paused, not deleted; their prompts still asked Grade for product details and couldn't be edited safely.
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
- **The week, seven posts (one a day, decided 30 Oct):**
  - Mon: myth buster
  - Tue: education carousel
  - Wed: story reel (Lily, then Temi, Ronke and Ike for young adults from 25 Nov, then the rest)
  - Thu: Ask Intimova, a question people are too shy to ask
  - Fri: quote card
  - Sat: tip, alternating young adults and couples
  - Sun: product
- **Why seven:** Buffer's study of 2.1 million posts (Aug 2025) found 3–5 a week is the "sweet spot", with more reach at 6–9 (about 18% more per post) and diminishing returns. Instagram's Mosseri names watch time, likes and sends as the top ranking signals, so the stories carry watch time and the myths and asks are written to be sent to a friend.
- **Meta's rule on products (checked 30 Oct):** under Restricted Goods and Services → Health and Wellness, Meta restricts posts promoting sex toys, and "sex education with focus on sexual pleasure", to adults 18 and over. They're not removed. "Depiction of sex toys with no clear context" is restricted too, so every product photo sits in a guide.

## Open items

1. Product guides: take the details from intimova.ng/shop (each product page lists price, materials, care, delivery and returns). Use only what the page states; it doesn't mention Paystack.
2. Done 27 Oct: Grade deployed the posting alarm (README step 8). Its first run started "Publish due posts" at 22:38 Lagos and succeeded. The GitHub token it uses expires on the date Grade chose; when it does, make a new one and run `npx wrangler secret put GITHUB_TOKEN` in `alarm/`. If a post is ever late, run the workflow by hand with Dry run unticked and `only_post` set to the post's id.
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
