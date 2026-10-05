# Strategic Energy Infrastructure Map

Static site deployed on Vercel from `main`. The build (`scripts/build.mjs`, no dependencies) copies the map into `dist/` and generates ~150 crawlable answer pages from `data/`: https://strategicenergymap.org

- `index.html`, `styles.css`, `app.js` — the page. Leaflet 1.9.4 from cdnjs. It only renders; content lives in `data/`. `?embed=1` gives a map-only view.
- `dashboard.css`, `dashboard.js` — the `/dashboard/` page (dark "Aubergine" high-contrast theme, dashboard only). `scripts/build.mjs` writes the page, `/data/v1/dashboard.json` (the bundle `dashboard.js` renders) and a CSV + JSON per dataset in `/data/v1/` (CC BY 4.0). The page loads its own stylesheet instead of `styles.css`; the build adds `?v=` content hashes itself.
- `about.html` — About & methods page; renders live counts and `data/changelog.json`. Keep it in step with how the site actually works.
- `og.png` — link-preview image, rendered from `tools/og-card.html` (command in README).
- `data/*.json` — all content. Schema and ownership rules: `agent/SCHEMA.md`.
- `scripts/update_fuel.py` — refreshes official pump prices (EIA, EU Weekly Oil Bulletin, UK DESNZ, ECB FX). Stdlib only.
- `tools/video/` — scripted walkthrough videos of the real map (headless Chrome + ffmpeg, own `package.json`). See its README.
- `media/` — self-hosted web versions of the videos plus `videos.json`, written by `tools/video/publish.mjs` (don't hand-edit). Rendered on the About page (tour, What-if, daily updates, embed sections) and by the map's Tour button, which also shows new visitors a one-time prompt (`localStorage["sem.tour"]`, never in embeds); `?tour=1` opens the tour directly. Self-hosted on purpose: YouTube embeds would add third-party cookies.
- `scripts/validate.mjs` — validates `data/`. Run after every data change; must pass before committing.
- `agent/UPDATE_AGENT.md` — instructions for the scheduled news/conflict update agent.
- `agent/SOURCE_REVIEW.md` — monthly source-review agent; maintains `data/sources.json` (PR only). `scripts/source_activity.mjs` gives it citation counts and unregistered domains.

Live data fetched in the browser: IMF PortWatch daily chokepoint transits (ArcGIS REST, CORS-enabled, no key).

## Local preview
Build, then serve `dist/` (`fetch()` doesn't work from `file://`):
```
node scripts/build.mjs && python3 -m http.server 8765 -d dist
```
then open http://localhost:8765. Generated pages: `/dashboard/`, `/data/v1/*.csv|json`, `/chokepoints/<id>/`, `/facilities/<id>/`, `/fuel-prices/<id>/`, `/charts/<id>/`, hubs, `/events/`, `/events.xml`, `sitemap.xml`, `robots.txt`. Never edit `dist/`; change the templates in `scripts/build.mjs` or the data.

## Conventions
- Asset ids are stable kebab-case; `status.json`, `events.json`, `scenarios.json` reference them. Never rename an id without updating every reference.
- All text rendered from data goes through `esc()` in `app.js`; source links through `safeUrl()`. Keep it that way — the data is written from web research.
- Pre-crisis reference week is 2026-02-23 (`fuel.json → pre_crisis_date`, `market.json → pre_crisis`, PortWatch baseline window in `app.js`).
- When you change `app.js` or `styles.css`, bump the `?v=` query on their tags in `index.html` so browsers don't serve a stale copy.
- Goal: a free, ad-free public resource. No ads, no cookies, no trackers beyond Vercel Web Analytics.
- Primary domain is strategicenergymap.org. `vercel.json` 301-redirects the old energy-infrastructure-map.vercel.app host; www and .com hosts are attached to the project and redirect via the same `vercel.json` rules. `/embed` is a temporary redirect to `about.html#embed` (the embed code), used in videos and posts.
- SEO/AEO: each generated page opens with a dated, sourced 40–60 word answer, then facts, FAQ and JSON-LD. Only generate a page when there's real data behind it (no thin pages). `scripts/indexnow.mjs` pings Bing after a deploy.
- Do not set `trailingSlash` in `vercel.json`: it 308-redirects `/_vercel/insights/*` and breaks Vercel Web Analytics. Canonical tags already point at trailing-slash URLs.
- Owner opt-out: any page with `?notrack=1` sets `localStorage["va-disable"]` and a `beforeSend` hook drops that browser's analytics (`?notrack=0` undoes it). The snippet sits in `index.html`, `about.html` and the page template in `scripts/build.mjs`; keep all three in step.
- Social: the agent drafts posts in `data/social.json`; `.github/workflows/social.yml` posts them to X and Bluesky with repository secrets (`scripts/social_post.mjs`) and writes `data/social-log.json`. Credentials never go to the agent. Kill switch: `enabled: false`. Chart images come from `dist/social/*.html` (built by `scripts/build.mjs`).
- Human alerts: `.github/workflows/health.yml` ("Needs you", daily 12:30 UTC, `scripts/health.mjs`) fails when a review PR is open, the daily update didn't run, a post gave up after 3 tries, or data on main doesn't validate; GitHub's failed-run email is the alert. The posting workflow also fails (and emails) when a post gives up.
