# Intimova content pipeline

This repo makes and posts Intimova's social content.

- **Claude drafts the week.** Every Saturday Claude writes the next week's five posts from the content library (`library/`, about six months planned ahead), renders them (story reels and carousels), and opens a pull request.
- **You approve.** You review the pull request on your phone. Comment to change something; merge to approve.
- **It posts itself.** A GitHub job that runs every 10 minutes posts each approved post at its time to Instagram and Facebook, and to X once it's connected. For TikTok, it sends you the files and caption to post by hand.

Nothing posts unless it is merged into `main`. A post with `"hold": true` never posts on its own.

## How a week runs

1. **Saturday 10:00 (Lagos).** Claude opens a pull request named "Intimova: week of …". It shows every slide, the reel cover with a link to watch it, and every caption.
2. **Saturday to Sunday.** You review it in the GitHub app.
   - To change something, comment on the post. Claude's Sunday 18:00 run makes the fixes.
   - To approve, merge the pull request.
3. **After the merge.** Cloudflare publishes the images and videos at `https://media.intimova.ng` within a minute or two.
4. **At each post's time.** The **Publish due posts** job runs every 10 minutes from 06:08 to 22:58 and posts whatever is due, so a post goes out within about 10 minutes of its time. A Cloudflare alarm starts it (setup step 8), because GitHub's own schedule skips runs when GitHub is busy. GitHub's schedule stays on as a backup.
5. **TikTok.** You get a GitHub notification titled "Post to TikTok" with the files and caption. Post it by hand, then close the issue.

If a platform fails, the job retries it on the next run, up to three times. GitHub emails you when a run fails. Platforms that already worked are never posted twice.

A product post is held, and the run fails so GitHub emails you, if the product's price or stock on intimova.ng has changed since the post was made.

Every Saturday at 07:13 the **Read post results and product prices** job saves each recent post's Instagram and Facebook numbers (reach, saves, shares, comments) to `state/insights.json`, and every product's price and stock to `state/products.json`. The Saturday draft reads both (Claude's cloud runs can't reach intimova.ng themselves).

## The week, and the library

| Day | Post | From |
| --- | --- | --- |
| Mon | Myth vs fact | `library/myths.json` |
| Tue | Education carousel | `library/carousels.json` |
| Wed | Story reel | `library/stories.json` |
| Fri | Quote card or couples tip | `library/quotes-tips.json` |
| Sun | Product | `library/products.json` |

`npm run runway` shows how many weeks each day has left, and each week's pull request ends with the same table. See `library/README.md`.

## One-time setup

This takes about 2 hours, plus however long TikTok takes to approve the app; I don't know how long that is. Do the steps in order.

### 1. GitHub

1. Create a **private** repository called `intimova-content` on GitHub.
2. Push this folder to it:
   ```
   cd intimova-content
   git init && git add . && git commit -m "Intimova pipeline"
   git branch -M main
   git remote add origin https://github.com/<you>/intimova-content.git
   git push -u origin main
   ```
3. Connect GitHub to Claude in your Claude settings, so the weekly runs can push and open pull requests.

### 2. Image and video hosting (Cloudflare Pages, free)

Instagram, Facebook and TikTok fetch media from a public link, so the `public/` folder needs a web address. Menu names below may differ slightly in Cloudflare's dashboard.

1. Create a Cloudflare account. Then go to Workers & Pages > Create > Pages > Connect to Git, and pick `intimova-content`.
2. Leave the build command empty, set the output directory to `public`, then deploy.
3. Add the custom domain `media.intimova.ng` to the Pages project. If intimova.ng's DNS isn't on Cloudflare, add the CNAME record it shows you at your DNS provider.
4. In GitHub, go to Settings > Secrets and variables > Actions > **Variables**. Add `MEDIA_BASE_URL` = `https://media.intimova.ng`.

`wrangler.jsonc` tells Cloudflare to serve the `public/` folder. If the custom domain isn't ready yet, set `MEDIA_BASE_URL` to the `https://intimova-content.<your-subdomain>.workers.dev` address Cloudflare shows. Instagram, Facebook and X accept it. TikTok needs a verified domain, so switch to `media.intimova.ng` before connecting TikTok.

Check that `https://media.intimova.ng/robots.txt` opens. Facebook refuses video from sites that block its crawler, and that file allows it.

### 3. Meta (Instagram and Facebook)

1. Make the Intimova Instagram a professional account, and link it to the Intimova Facebook Page.
2. At developers.facebook.com, create an app (type Business) with you as admin. Add Facebook Login for Business and the Instagram API with Facebook Login. Meta says an app that only serves accounts you manage needs Standard Access, so no App Review.
3. If Meta asks the Page for **Page Publishing Authorization**, complete it. Posting is blocked until you do.
4. In Graph API Explorer, generate a user token with the permissions listed at the top of `publisher/setup/meta.mjs`. Then run:
   ```
   npm install
   export META_APP_ID=... META_APP_SECRET=... META_SHORT_TOKEN=...
   npm run setup:meta
   ```
5. Add the secrets it prints (`META_PAGE_ID`, `IG_USER_ID`, `META_PAGE_TOKEN`) under Settings > Secrets and variables > Actions > **Secrets**.
6. **Switch the app from Development to Live** with the toggle at the top of the App Dashboard. Meta says anything a Development-mode app posts "can only be seen by role users", so without this your followers won't see the posts. Meta may ask for a privacy policy URL (for example intimova.ng/privacy) and an app icon. I'm not certain what else it will ask for an app that only posts to your own accounts.

### 4. The encryption key

X and TikTok logins change every time they refresh, so the job keeps them in `state/tokens.enc`, encrypted.

```
npm run setup:key
```

Save the key it prints as the GitHub secret `TOKENS_KEY`, and in your password manager.

### 5. X

1. In the X developer console, set up pay-per-use credit. A few dollars covers months, at about $0.015 a post without a link.
2. Create an app. Under User authentication settings, turn on OAuth 2.0, choose type **Web App**, allow **Read and write**, and set the callback URL to `https://intimova.ng/oauth/x` (the page can be blank).
3. Run:
   ```
   export X_CLIENT_ID=... X_CLIENT_SECRET=... X_REDIRECT_URI=https://intimova.ng/oauth/x TOKENS_KEY=...
   npm run setup:x
   ```
4. Add the secrets `X_CLIENT_ID` and `X_CLIENT_SECRET`, then commit and push `state/tokens.enc`.

### 6. TikTok (posted by hand)

TikTok's app review doesn't allow apps that only post to your own account, or apps for adult products, so TikTok isn't automated.
Instead, when a post's time comes, the job opens a GitHub issue titled **"Post to TikTok: …"** and tags you, so the GitHub app alerts you.
The issue has links to each slide or the video, and the title and caption ready to copy. Post it, then close the issue. It takes about 2 minutes.
For this to work, `PLATFORMS` must not include `tiktok`. The default is `instagram,facebook`.

### 7. Test before the first live week

1. Go to Actions > **Publish due posts** > Run workflow, and leave **Dry run** ticked. The summary shows what would post and whether the media links work.
2. Post the test card (`content/test/hello`, "Something warm is coming.") to **one platform at a time**:
   - Set the repository variable `PLATFORMS` to `instagram`.
   - Run the workflow with Dry run unticked and `only_post` = `test-hello`.
   - Check the post on Instagram, then delete it.
   - Repeat with `facebook`, `x`, then `tiktok`.
3. When each platform works, delete the `PLATFORMS` variable, so all four are used again.
4. Delete the `test-hello` entry from `state/posted.json`, so the test card can be used again later.

### 8. The posting alarm (Cloudflare, about 10 minutes)

GitHub's own schedule is unreliable. GitHub's docs say scheduled runs "can be delayed during periods of high loads" and "some queued jobs may be dropped". On 26–27 Oct it started only 4 of the 20-plus runs due.
So a tiny Cloudflare Worker in `alarm/` starts the job every 10 minutes instead, and GitHub's schedule stays as a backup. Cloudflare's free plan allows 5 of these schedules per account; this uses 1.

1. **Make a GitHub token** that can only start this repo's jobs. In GitHub, go to Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token.
   - Repository access: **Only select repositories**, then `intimova-content`.
   - Permissions: under Repository permissions, set **Actions** to **Read and write**. Leave everything else as it is.
   - Expiration: the longest it offers. Put the end date in your calendar, because posting stops starting on time when it expires.
   - Copy the token.
2. **Deploy the alarm** from this repo on your computer:
   ```
   git pull
   cd alarm
   npx wrangler login                    # opens the browser to sign in to Cloudflare
   npx wrangler deploy
   npx wrangler secret put GITHUB_TOKEN  # paste the token when it asks
   ```
3. **Check it.** After the next :08, :18, :28 … mark, Actions > **Publish due posts** shows a new run with the event `workflow_dispatch`. The Worker's logs in Cloudflare (Workers & Pages > intimova-alarm) say "Started the publisher".

If the token expires, make a new one and run `npx wrangler secret put GITHUB_TOKEN` again.

## Things I couldn't confirm from the platforms' docs

Your test posts will settle each of these:

- **The Page token may not be enough for Instagram.** Meta's docs don't say whether a Page token can publish to Instagram. `setup:meta` checks that it can read the account. If publishing is refused, add `META_IG_TOKEN`; the script prints it when needed.
- **Instagram may crop the carousel.** Meta says carousel images are cropped to the first image's shape. The slides are 4:5, which Instagram allows, so check the first carousel isn't cut square.
- **The Facebook photo limit isn't documented.** Meta doesn't state how many photos one post can hold; one third-party guide says 4. If Facebook refuses a 5-slide post, tell Claude.
- **X shows 4 images per post (as far as I know).** Longer carousels continue as a reply thread.
- **TikTok's example uses WebP images.** These slides are JPEG. If TikTok refuses them, Claude can render WebP.
- **Cloudflare Pages' free plan:** check its terms allow a commercial site. As far as I know, each file must be under 25 MB, and the reel engine keeps files under 24 MB.

## Running it yourself

- `npm test`: publisher tests against a fake copy of all four APIs. No internet needed.
- `node engine/validate.mjs`: checks every upcoming post's captions, safety fields and rendered files.
- `npm run render -- content/<week>`: renders a week. This needs Playwright with Chromium, ffmpeg, and python3 with numpy, scipy and Pillow. Claude's workspace has all of them.

## Folder map

| Folder | What's in it |
| --- | --- |
| `content/<monday>/<post>/post.json` | One post: time, platforms, captions, and the story or slides |
| `public/<monday>/<post>/` | Rendered media served at media.intimova.ng |
| `engine/` | The reel and carousel renderers |
| `publisher/` | The posting job and the one-time setup scripts |
| `state/posted.json` | What was posted, where, and its post IDs |
| `state/tokens.enc` | Encrypted X and TikTok logins |
| `CLAUDE.md` | Instructions for Claude's weekly runs |
