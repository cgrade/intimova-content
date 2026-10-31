# Intimova admin (admin.intimova.ng)

A private, phone-first page with three tabs:

- **Week**: this week's posts, with every slide and caption, and whether each went out.
- **Approve**: next week's draft with real previews. **Approve the week** merges its pull request (only the version you looked at). **Ask for a change** adds a comment to the pull request, which the Sunday run (17:40 Lagos) applies.
- **TikTok**: each hand-posted TikTok: save the files, copy the title and caption, and **I've posted it** (closes the GitHub issue).

GitHub stays the source of truth: the page only reads the repo and calls GitHub's API. If the page is ever down, posting carries on.

## Who can open it

Cloudflare Access. The Worker refuses every request, the page itself included, unless Access has signed the person in. Until you switch Access on, the page shows "Sign in through Cloudflare Access" and nothing else.

## One-time setup

1. **A GitHub token for the page.** github.com → Settings → Developer settings → Fine-grained tokens → Generate new token.
   - Repository access: only `cgrade/intimova-content`.
   - Repository permissions: **Contents: Read and write** (merging a pull request needs it), **Pull requests: Read**, **Issues: Read and write**. Nothing else.
   - Choose an expiry and note it down; when it expires the page stops loading (posting is not affected).
2. **Deploy.** In this folder:
   ```
   npx wrangler secret put GITHUB_TOKEN     # paste the token
   npx wrangler deploy
   ```
   This creates the Worker `intimova-admin` and the custom domain `admin.intimova.ng`.
3. **Turn on Access.** Cloudflare dashboard → **Workers & Pages** → **intimova-admin** → **Access** tab → **Protect this Worker behind Access** → **All traffic** → under who can sign in, choose your email address → **Apply Access**.
4. **Optional, belt and braces:** `npx wrangler secret put ALLOWED_EMAILS` with your email address. The Worker then also refuses any other signed-in account.
5. On your phone, open https://admin.intimova.ng, sign in, and use **Share → Add to Home Screen** so it opens like an app.

## Checks

`npm test` (from the repo root) runs `test/admin.test.mjs`: the Access check fails closed, changes need the page's own header, approve only merges week pull requests at the version you saw, "I've posted it" only closes TikTok issues, and downloads only serve Intimova's own files.
