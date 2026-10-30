# Content library

Everything Intimova's social posts can draw on, planned about six months ahead, so the Saturday run never starts from a blank page.

| File | Day | What's in it |
| --- | --- | --- |
| `myths.json` | Mon | Myths, each with the research findings that answer it |
| `carousels.json` | Tue | Education carousels, one per intimova.ng article (adapted from the old carousel library) |
| `stories.json` | Wed | Story series, 4 parts each, with the beats for every part |
| `asks.json` | Thu | Ask Intimova: questions people are too shy to ask, answered from one intimova.ng article |
| `quotes-tips.json` | Fri, Sat | Original quote lines (Friday) and tips for young adults and couples (Saturday) |
| `products.json` | Sun | Product post angles, and the product catalogue with what's on hold |
| `sources.json` | — | Every research source a post may cite, with safe wording, country and cautions |

## How it's used

- `npm run runway -- 2026-11-02 --live` shows each day's next item and how many weeks are left. Under 6 weeks is flagged, and the Saturday run adds new, researched items to that file.
- `npm run products` shows each product's live price and stock on intimova.ng. Out-of-stock products are skipped.
- Every Saturday at 07:13 GitHub saves copies of the product pages and library articles to `state/site/`, and prices to `state/products.json` (`node engine/site-snapshot.mjs`). Claude's cloud runs can't reach intimova.ng, so they read these.
- A post records what it used with `"library": "<id>"`. That's how an item counts as used; there is no separate list to keep up to date.
- `node engine/validate.mjs` (and the pull request check) fails if a library item cites a source that doesn't exist, or a post names a library id or product that doesn't exist.

## Statuses

- `ready`: can be drafted.
- `hold`: needs Grade's decision first (legal statements, male toys, performance products, a source still to check).
- `used`: already posted before the library existed.
- `website-only`: fine on intimova.ng, too explicit for social. Never drafted.

## Rules

- Health facts come only from `sources.json`, in its wording, with the source on the slide.
- Carousels say only what their article says. Product posts say only what the live product page says; never copy explicit product wording.
- Leave about 6 weeks between posts on the same topic across days (e.g. the lube myth on Monday and the lube carousel on Tuesday).
- The same product appears at most once every 4 weeks.

The marketplace (`cgrade/intomova_marketplace`) is only ever read, never changed: products come from its public pages, and sources marked `from_marketplace` mirror its citations library.
