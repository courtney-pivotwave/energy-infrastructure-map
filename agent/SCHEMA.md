# Data schema

The map is a static page (`index.html`) that renders everything from the JSON files in `data/`.
Nothing about the map's content lives in the HTML — to change what the map says, change the data.

| File | What it holds | Who edits it |
|---|---|---|
| `data/infrastructure.json` | The physical assets: pipelines, sites (production, refineries, hubs/LNG terminals), fields, chokepoints, tanker routes. Coordinates, capacity descriptions, geopolitical context. | Humans; the update agent only to **add** a newly relevant asset or correct a fact, never to delete. |
| `data/status.json` | Current operating status of any asset that is **not** running normally. | Update agent, every run. |
| `data/events.json` | Dated feed of developments (strikes, closures, sanctions, restarts, deals). | Update agent, every run (append; edit only to correct). |
| `data/market.json` | Latest benchmark prices with a pre-crisis reference. | Update agent, every run. |
| `data/social.json` | Draft posts for X and Bluesky, plus the kill switch. | Update agent appends drafts; humans set `enabled` / `dry_run`. |
| `data/social-log.json` | What was posted where (post IDs). | The posting GitHub Action only. Never edit. |
| `data/changelog.json` | Public changelog shown on the About page. | Update agent appends one entry per run with material changes; humans for site changes. |
| `data/scenarios.json` | Baseline flows through each chokepoint, bypass capacity, and most-exposed importers — used by the "what-if" closure mode. | Humans; agent may refresh figures when an authoritative source (EIA, IEA) publishes new numbers. |

Every asset has a stable `id` (kebab-case). `status.json`, `events.json` and `scenarios.json` refer to assets by that id.
Run `node scripts/validate.mjs` after any edit — it checks shape, enums, dates, and that every referenced id exists.

## Shared types

```jsonc
// Source — every factual claim the agent writes must carry at least one
{ "name": "ISW Iran Update", "url": "https://...", "date": "2026-09-26" }

// Confidence
"confirmed"   // 2+ independent reputable sources (or an official statement from a non-belligerent party)
"reported"    // one reputable independent outlet / think tank / data provider
"unverified"  // a claim by a party to the conflict (incl. the US government) not yet independently verified
// See "Source policy" in agent/UPDATE_AGENT.md.
```

## status.json

```jsonc
{
  "updated": "2026-09-27",            // date of the last agent run
  "assets": {
    "strait-of-hormuz": {
      "status": "closed",             // normal | reduced | disrupted | offline | closed | damaged
      "summary": "One or two sentences on what is happening now.",
      "since": "2026-03-01",          // when this status began (best known)
      "updated": "2026-09-27",        // when this entry was last verified
      "confidence": "confirmed",
      "sources": [ /* Source */ ]
    }
  }
}
```
Status meanings: **reduced** = running below normal; **disrupted** = intermittent/threatened, flows unreliable; **offline** = shut but intact; **damaged** = physically damaged; **closed** = chokepoint/route effectively closed to commercial traffic. When an asset returns to normal, **delete its entry** and log an event saying so.

## events.json

```jsonc
{
  "updated": "2026-09-27",
  "events": [
    {
      "id": "2026-09-26-kharg-strike",          // YYYY-MM-DD-short-slug, unique
      "date": "2026-09-26",                     // date the event happened (not published)
      "title": "Short headline, max ~90 chars",
      "summary": "2–4 sentences. What happened, why it matters for energy flows.",
      "category": "military",                  // military | shipping | infrastructure | policy | market | diplomatic
      "severity": "high",                       // low | medium | high | critical
      "coords": [29.23, 50.32],                 // or null if not location-specific
      "assets": ["kharg-island"],               // ids of related assets (may be empty)
      "confidence": "reported",
      "sources": [ /* Source */ ]
    }
  ]
}
```
Newest first. Keep every event; the page shows the most recent and filters by date.

## market.json

```jsonc
{
  "as_of": "2026-09-26",
  "benchmarks": [
    { "id": "brent", "label": "Brent", "unit": "$/bbl", "value": 0, "week_ago": 0, "pre_crisis": 0,
      "source": { /* Source */ } }
    // ids: brent, wti, dubai, ttf, jkm, henry-hub
  ],
  "note": "Optional one-line market read, sourced."
}
```
`pre_crisis` is a fixed reference (late Feb 2026) so the page can show the change since the crisis began.

## scenarios.json

```jsonc
{
  "chokepoints": {
    "strait-of-hormuz": {
      "portwatch": "Strait of Hormuz",        // IMF PortWatch portname for live transit counts (optional)
      "oil_mbd": 20.0,                         // crude + products, pre-crisis baseline
      "lng_share_pct": 20,                     // share of global LNG trade
      "bypass": [ { "asset": "east-west-pipeline", "spare_mbd": 2.6, "note": "..." } ],
      "reroute": "none",                       // none | cape (can ships sail around?) 
      "reroute_days": 0,
      "exposed": [ { "country": "China", "note": "..." } ],
      "sources": [ /* Source */ ]
    }
  }
}
```

## fuel.json

Retail pump prices (including taxes). Most entries are written by `scripts/update_fuel.py` from official weekly feeds — **don't hand-edit those** (`feed`: `eia`, `eu-oil-bulletin`, `uk-desnz`); rerun the script instead.

Countries with no open feed are added by the update agent with `"feed": "agent"`. The script preserves them. Same shape:

```jsonc
{
  "id": "jp", "name": "Japan", "group": "country", "coords": [36.2, 138.3],
  "currency": "JPY", "unit": "¥/l", "date": "2026-09-22",
  "petrol": { "now": 0, "week_ago": null, "pre_crisis": 0, "date": "2026-09-22",
              "history": [["2026-02-23", 0], ["2026-09-22", 0]] },   // append one point per update
  "diesel": { ...same, or null if not available },
  "usd_per_litre": { "petrol": 0, "diesel": 0 },                  // convert with fuel.json → fx, or state the rate used
  "feed": "agent", "confidence": "confirmed",
  "sources": [ /* Source */ ]
}
```
Target set for agent entries: Japan, South Korea, China, India, Canada, Australia, Brazil, South Africa. Use national official series where they exist (e.g. METI/ANRE weekly survey for Japan, Opinet for Korea, NDRC price adjustments for China, PPAC for India, Statistics Canada / NRCan weekly, Australian Institute of Petroleum, ANP for Brazil, South Africa DMRE monthly adjustments). `pre_crisis` = the value closest to, and not after, `fuel.json → pre_crisis_date`.

## changelog.json

```jsonc
{
  "entries": [                       // newest first
    { "date": "2026-09-28", "kind": "data",          // data | site | policy
      "headline": "Plain-language summary, max ~90 chars",
      "changes": ["Short bullet", "Another"] }         // 1–6 bullets, for a general reader
  ]
}
```

## social.json

```jsonc
{
  "enabled": true,        // kill switch: false pauses all posting immediately
  "dry_run": false,       // true: the Action only prints what it would post
  "max_per_day": 6,
  "x_links": ["announcement", "digest", "correction"],   // post types that include the link on X (Bluesky: always)
  "hashtags": ["OOTT", "Oil", "LNG", "Hormuz", "..."],     // approved tags; posts may only use these
  "posts": [
    { "id": "2026-09-28-east-west-restart", "created": "2026-09-28",
      "type": "event",                      // event | digest | chart | correction | announcement
      "text": "Saudi Arabia restarted the East-West pipeline at reduced rates after drone strikes shut it on 11 Sep (reported).",
      "url": "https://strategicenergymap.org/facilities/east-west-pipeline/",
      "event_id": "2026-09-22-east-west-pipeline-restart",   // required for event posts
      "image": null, "alt": null,           // image: fuel-weekly | chokepoints-weekly (alt text required)
      "tags": ["Hormuz", "OOTT"],           // 1–3 from hashtags, most specific first; X uses the first 2
      "reply_to": null }                    // earlier post id (required for corrections)
  ]
}
```
Drafts older than 48 hours are never posted. The Action retries a failed platform up to 3 times.
