# Weekly run instructions for Claude

This repo is Intimova's content pipeline. **For the current state, open items and the decisions made so far, read `HANDOFF.md` first.** Each week Claude drafts and renders the next week's posts and opens a pull request. Grade approves by merging. GitHub Actions then posts each one at its time.

## References

- Content playbook (brand, pillars, formats, health rules, story craft): https://claude.ai/artifact/5zjobeTQXa7s2NYd5M7Uw1
- Pipeline plan: https://claude.ai/artifact/JysPkaahaLMbyybpCCcZtx
- Intimova tab of the roadmap doc (work log): doc 4b861a63-63d1-46b0-a3ea-3df7f0bf0f40

## Saturday run (10:00 WAT): draft the next week

1. Work out the coming Monday's date. The week folder is `content/<YYYY-MM-DD of that Monday>/`.
2. Read the playbook, the last two weeks' folders, and `state/posted.json`, so you continue the story series and don't repeat a fact.
3. Write one `post.json` per post, following the starter week unless Grade has moved to the full week:

   | Day | Post | Format |
   | --- | --- | --- |
   | Mon | Fact or myth-buster | carousel (5 slides: myth/cover, fact, fact or text, takeaway) |
   | Wed | Story, next part of the current series | reel |
   | Fri | Quote card or couples tip | carousel (1 slide, or 5 for a tip) |
   | Sun | Product guide | carousel, needs Grade's product details (ask in NEEDS-INPUT.md) |

   All posts go out at 19:30 Lagos time unless Grade changes it.
4. Rules that never bend:
   - Stories: words carry the heat. Above-medium sensual language is fine, but never explicit acts, anatomical or crude words. Every character is clearly an adult. She chooses herself in the end of a series.
   - Reels must stay at or under 89.5 seconds (Facebook's limit is 90). The engine speeds up slightly to fit, and refuses past that. Cut lines if it refuses.
   - Health facts: every number has a named source on the slide; never "cures", "treats" or "prevents"; say "a link, not proof" when the study is observational. Note the country the data comes from.
   - X posts under 280 characters and without links, because a link costs more. Instagram has a 2,200 character limit and allows 30 hashtags at most.
   - Fill in `safety` honestly. Set `hold: true` on anything that needs Grade's input.
5. Render, check, preview:
   ```
   npm run render -- content/<week>
   node engine/validate.mjs
   npm test
   REPO_URL=https://github.com/<owner>/intimova-content BRANCH=week/<week> npm run preview -- content/<week>
   ```
   Look at every rendered slide and at least 6 frames of each reel before opening the pull request.
6. Commit to the branch `week/<week>`, push, and open a pull request titled `Intimova: week of <D Month>`, with `content/<week>/PREVIEW.md` as its description.
7. Add a line to the Intimova work log in the roadmap doc.

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
- Rendering needs Playwright with Chromium, ffmpeg, and python3 with numpy, scipy and Pillow. All of these exist in Claude's workspace.
