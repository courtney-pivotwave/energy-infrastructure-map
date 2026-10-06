# Content ideas

Backlog of content strategy ideas to pick up later. Newest at the top. Nothing here is scheduled yet.

## 2026-10-03: Data dashboard

A very rich, interactive dashboard of every key data point on the site, built as a working resource for reporters,
non-profits, citizens, content creators and analysts.

**Mockup 2026-10-03:** [`docs/mockups/dashboard.html`](mockups/dashboard.html), an interactive page built from a snapshot
of `data/` and PortWatch that day (open it in a browser; "Show design notes" explains each panel). It surfaced four
gaps to close before building: no reuse licence on the site yet, no stored history for market benchmarks, asset
capacities only in free text, and **no Asian pump prices**. Asia matters most here: the EIA estimates 84% of Hormuz crude
went to Asian markets in 2024, and many Asian governments set or subsidise pump prices, so the stress shows up as
subsidy bills and sudden official hikes. The mockup's Asia tab lists 12 countries with candidate official sources
(unvetted) to feed the monthly source review and `scripts/update_fuel.py`.

**Colour direction 2026-10-04:** a dark theme in the **Aubergine** palette at **High** contrast (all text AAA, chart
colours at least 4.5:1 on the panels). See [`docs/mockups/dashboard-palettes.html`](mockups/dashboard-palettes.html),
which holds every palette's values and the contrast-tuning code. A bolder "observatory" experiment
([`docs/mockups/observatory.html`](mockups/observatory.html): one timeline driving ridgelines, a price heatmap and an
event swarm) was judged too much for this page; individual pieces such as the
pump-price heatmap could still be reused.

Notes for when we pick it up:
- **What's already in `data/`:** 8 chokepoints with live PortWatch transits against the pre-war baseline; 26 pipelines,
  68 sites, 64 fields and 10 routes with capacities and current status (`status.json`); 5 market benchmarks; pump
  prices for 36 country/fuel entries since the 2026-02-23 reference week; 76 dated events; What-if scenarios; 88
  registered sources. Most of the dashboard is views over this data. The new datasets in the "Data visualizations"
  entry below would add depth later.
- **Features for these audiences:** filter, sort and compare across assets, countries and dates; every number dated and
  linked to its source; CSV/JSON download of each table (an open data API in practice); "cite this" text and
  permalinks that keep the current filters; embeddable panels with credit, reusing the `?embed=1` pattern.
- **Fit with the site:** a `/dashboard/` page (or `/data/`) built from the same `data/` files so it stays current with
  the daily agent. Only show panels with real data behind them. No new trackers or cookies; the `esc()` and `safeUrl()`
  rules apply to everything rendered.
- **Overlap to settle:** the `/charts/` experiment (2026-09-30) and the generated answer pages. The dashboard could become
  the hub that links to both.

**2026-10-05 brief:** first version shipped Oct 5 (PR #4). Follow-ups (Asian pump prices, benchmark history) held while two review PRs wait.

## 2026-09-30: Data visualizations

**Experiment live 2026-09-30:** [/charts/](https://strategicenergymap.org/charts/) with four charts (oil flows per chokepoint, Hormuz
bypass capacity, tanker traffic, diesel since the crisis) and two chart posts. Judge at the growth check-in: chart-page
visits, search impressions for `/charts/`, and Bluesky link clicks and engagement on the chart posts compared with text posts.

**2026-10-05 brief:** judge date set for Nov 2; continued (too few chart posts, and visits and search not collected yet).

A library of charts and interactive visuals built on statistical data: trends, market share, trade flows, consumption,
and more.

Possible data vectors to start from:
- **Supply and demand:** production and consumption by country and region over time; import dependence (share of a
  country's oil or gas that's imported, and from where).
- **Flows:** trade flows between exporters and importers (Sankey or flow maps); share of each importer's supply that
  passes through each chokepoint; LNG trade routes.
- **Chokepoints:** transit history from PortWatch against the pre-war baseline; how disruptions compare with past ones
  (1980s tanker war, 2019, the Red Sea attacks).
- **Prices:** benchmark history and spreads (Brent–WTI, TTF–JKM); pump prices over time, and how much of the pump price
  is tax versus crude.
- **Resilience:** strategic reserves in days of import cover; refinery capacity; spare production capacity and where
  it sits.
- **Energy mix and transition:** electricity mix, and how the crisis shifts demand toward other fuels.

Notes for when we pick it up:
- Candidate open data (check licences; most allow reuse with attribution): Energy Institute Statistical Review of World
  Energy, JODI, Our World in Data energy dataset (CC BY), Ember (electricity, CC BY), Eurostat, UN Comtrade (trade
  flows), IMF PortWatch, Global Energy Monitor, EIA international data (statistics are fine under the source policy).
  Add each to `data/sources.json` through the monthly source review.
- Formats: interactive chart pages that each open with a dated one-line takeaway (good for search and AI answers, with
  schema.org `Dataset` markup), static images for social (the pipeline already renders charts from `dist/social/`), and
  embeddable versions for others to use with credit.
- Could run as a recurring "chart of the week" feeding the Monday/Thursday chart posts, and link from the chokepoint
  pillars and facility pages.

## 2026-09-30: Chokepoint pillars and clusters

A pillar-and-cluster structure covering **every chokepoint on the map**, not just the big five: Hormuz,
Bab el-Mandeb, Suez, Malacca, the Turkish Straits, Panama, the Cape of Good Hope and the Eastern Mediterranean, plus
any added later.

- **Pillars:** one long-form explainer per chokepoint, covering its history, how much energy moves through it, who
  controls or contests it, past disruptions and where it stands today.
- **Clusters:** shorter articles on acute events (an attack, a closure, a reopening deal) that explain the current
  state and how it got there, each linking up to its pillar and across to related clusters.

Notes for when we pick it up:
- The existing `/chokepoints/<id>/` answer pages are the natural pillar URLs. They'd grow from an answer page into a
  long read, keeping the dated answer at the top.
- Pillar depth can scale with how much is happening: Hormuz and Bab el-Mandeb have far more cluster material right
  now than Panama or the Cape.
- Clusters could grow out of `events.json`: a significant event gets an article, and the daily agent keeps its "current
  state" section fresh.

## 2026-09-30: Geopolitical and historical explainers, plus corruption and business news

Explainers on key pipelines, energy agreements, business context, corruption, and how energy policy shapes the world.
**Also aggregate energy-sector corruption and business-conduct news** as an ongoing feed, sourced from reputable
non-profit investigative journalism.

Notes for when we pick it up:
- Explainers fit the facility pages and could be a new "Explainers" hub; the news feed could be its own tab/page and
  link to the assets and companies involved.
- **Sourcing to work out.** Start from non-profit investigative outlets like OCCRP, Transparency International and
  ProPublica. Other candidates to vet: Global Witness (energy and extractives), ICIJ (Panama/Pandora Papers), the
  Natural Resource Governance Institute, Public Eye (commodity traders), The Sentry, Finance Uncovered and Bellingcat.
  EITI publishes official disclosure data. (Global Energy Monitor was adopted as an asset-data source on 2026-09-30.)
- Stricter rules than the news feed: court findings, official investigations and these outlets' own reporting only;
  every claim attributed to the outlet that reported it; allegations, charges and convictions clearly distinguished;
  nothing that rests on a party to a conflict.
- The "no private individuals" rule needs a clear line for this feed: executives and officials named in their public or
  corporate role in published investigations are likely fine; relatives, employees and bystanders are not.
- Aggregation mechanics: most of these outlets publish RSS feeds, so the daily agent (or a separate one) could scan them,
  keep only energy-relevant stories and summarise with a link back, never republishing their text.
- Long-form pieces need a human editorial pass before publishing, not the agent's direct-to-main path.
