# Strategic Energy Infrastructure Map

Static site (no build step) deployed on Vercel from `main`: https://energy-infrastructure-map.vercel.app

- `index.html`, `styles.css`, `app.js` — the page. Leaflet 1.9.4 from cdnjs. It only renders; content lives in `data/`. `?embed=1` gives a map-only view.
- `about.html` — About & methods page; renders live counts and `data/changelog.json`. Keep it in step with how the site actually works.
- `og.png` — link-preview image, rendered from `tools/og-card.html` (command in README).
- `data/*.json` — all content. Schema and ownership rules: `agent/SCHEMA.md`.
- `scripts/update_fuel.py` — refreshes official pump prices (EIA, EU Weekly Oil Bulletin, UK DESNZ, ECB FX). Stdlib only.
- `scripts/validate.mjs` — validates `data/`. Run after every data change; must pass before committing.
- `agent/UPDATE_AGENT.md` — instructions for the scheduled news/conflict update agent.

Live data fetched in the browser: IMF PortWatch daily chokepoint transits (ArcGIS REST, CORS-enabled, no key).

## Local preview
`fetch()` doesn't work from `file://`, so serve the folder:
```
python3 -m http.server 8765
```
then open http://localhost:8765.

## Conventions
- Asset ids are stable kebab-case; `status.json`, `events.json`, `scenarios.json` reference them. Never rename an id without updating every reference.
- All text rendered from data goes through `esc()` in `app.js`; source links through `safeUrl()`. Keep it that way — the data is written from web research.
- Pre-crisis reference week is 2026-02-23 (`fuel.json → pre_crisis_date`, `market.json → pre_crisis`, PortWatch baseline window in `app.js`).
- When you change `app.js` or `styles.css`, bump the `?v=` query on their tags in `index.html` so browsers don't serve a stale copy.
- Goal: a free, ad-free public resource. No ads, no cookies, no trackers beyond Vercel Web Analytics.
