# Weekly run instructions for Claude

This repo is Intimova's content pipeline. **For the current state, open items and the decisions made so far, read `HANDOFF.md` first.** Each week Claude drafts and renders the next week's posts and opens a pull request. Grade approves by merging. GitHub Actions then posts each one at its time.

## References

- Content playbook (brand, pillars, formats, health rules, story craft): https://claude.ai/artifact/5zjobeTQXa7s2NYd5M7Uw1
- Pipeline plan: https://claude.ai/artifact/JysPkaahaLMbyybpCCcZtx
- Intimova tab of the roadmap doc (work log): doc 4b861a63-63d1-46b0-a3ea-3df7f0bf0f40

## Saturday run (10:00 WAT): draft the next week

1. Work out the coming Monday's date. The week folder is `content/<YYYY-MM-DD of that Monday>/`.
2. Read the playbook, the last two weeks' folders, `state/posted.json` and `state/insights.json` (how recent posts did), so you continue the story series, don't repeat a fact, and lean towards what's working.
3. Run `npm run runway -- <Monday's date> --live`. It shows, for each day, the next item to use from `library/` and how many weeks are left. See `library/README.md` for how the library works.
4. Write one `post.json` per post. Five posts a week, each built from the library item the runway names (you may pick a later ready item instead if it fits better, e.g. to keep 6 weeks between similar topics):

   | Day | Post | Format | Library file |
   | --- | --- | --- | --- |
   | Mon | Myth vs fact | carousel (5 slides: myth, fact, fact or what it means, takeaway) | `myths.json` |
   | Tue | Education carousel | carousel (6–7 slides, built on one intimova.ng article) | `carousels.json` |
   | Wed | Story, next part of the series | reel | `stories.json` |
   | Fri | Quote card or couples tip, alternating | carousel (1 slide, or 5 for a tip) | `quotes-tips.json` |
   | Sun | Product | carousel (5 slides) | `products.json` |

   - Record what each post used: `"library": "<item id>"` (story parts are `<series>-<n>`, e.g. `lily-2`).
   - Facts: only the findings a library item names, in `sources.json`'s wording, with the source on the slide. Carousels: only what the article page says. Products: only what the product page says, with the price from `npm run products`. Claude's cloud runs can't reach intimova.ng, so there read the copies GitHub saves every Saturday morning: `state/site/article-<slug>.txt` and `state/site/product-<slug>.txt` (and `npm run products` falls back to `state/products.json`). Add `"product": { "slug": "...", "price": <naira on the slides> }` so the publisher holds the post if the shop changes.
   - Never draft an item whose status is `hold` or `website-only`. If a slot has nothing ready, skip it and say so in the pull request.
   - All posts go out at 19:30 Lagos time unless Grade changes it.
5. Rules that never bend:
   - Stories: words carry the heat. Above-medium sensual language is fine, but never explicit acts, anatomical or crude words. Every character is clearly an adult. She chooses herself in the end of a series.
   - Story reels run up to 3 minutes: aim for about 500–550 words, and stay at or under 179.5 seconds (Instagram shows Reels of up to 3 minutes in the Reels tab). The engine speeds up slightly to fit, and refuses past that. Cut lines if it refuses. Reels over 90 seconds go to Facebook as a Page video, since Facebook Reels stop at 90.
   - Health facts: every number has a named source on the slide; never "cures", "treats" or "prevents"; say "a link, not proof" when the study is observational. Note the country the data comes from.
   - X posts under 280 characters and without links, because a link costs more. Instagram has a 2,200 character limit and allows 30 hashtags at most.
   - Fill in `safety` honestly. Set `hold: true` on anything that needs Grade's input.
6. Keep the library topped up. If any slot shows under 6 weeks left (⚠️ in the runway), add new items to that file in the same pull request: research them properly (named source, checked on the source's own page, country noted), mark them `ready`, and list them in the pull request description so Grade sees what was added.
7. Render, check, preview:
   ```
   npm run render -- content/<week>
   node engine/validate.mjs
   npm test
   REPO_URL=https://github.com/<owner>/intimova-content BRANCH=week/<week> npm run preview -- content/<week>
   ```
   Look at every rendered slide and at least 6 frames of each reel before opening the pull request. The preview ends with the library runway.
8. Commit to the branch `week/<week>`, push, and open a pull request titled `Intimova: week of <D Month>`, with `content/<week>/PREVIEW.md` as its description.
9. Add a line to the Intimova work log in the roadmap doc.

## Sunday run (18:00 WAT): apply Grade's comments

Read the open week pull request's comments. Make the changes, re-render the posts you touched (`--only <folder> --force`), update PREVIEW.md, and push to the same branch. Then reply to each comment saying what changed.

## Engine notes

- `story.scenes[].lines[]` hold `text`, which takes `*emphasis*`. They can also set `style` (`hook`, `sub`, `big`, `punch`), `slow: true`, and `cue`. Use `heat` and `peak` on scenes, and `lights` on a line, to drive the background.
- Every reel gets an original score (`engine/reel/score.py`) timed to the same cues. The score cues are:
  - `pulse`: a scene. The heartbeat enters (when the longing starts).
  - `turn`: a line. A surprise chord and a new cello line (a key emotional beat).
  - `heat` and `peak`: scenes. The tempo climbs from 56 to about 100 bpm, the music brightens and builds, and an endlessly rising tone sits under it.
  - `lights`: a line. A hard cut to silence, then switch clicks and hum. Use it for any sudden reveal or interruption, not just lights.
  - `dread`: a line. One heavy heartbeat on the cliffhanger line.

  Every story should set `pulse`, `turn`, `heat` and `peak`. Stories without a sharp interruption can skip `lights` and `dread`; the music then plays through to the end card. Set `"music": "none"` on a story to make it silent.
- Slide types: `cover`, `myth`, `fact`, `text`, `takeaway`, `quote`. In sources, `_text_` means italic.
- Rendering needs Playwright with Chromium, ffmpeg, and python3 with numpy, scipy and Pillow. In a Claude cloud run, `bash scripts/cloud-setup.sh` sets these up.
