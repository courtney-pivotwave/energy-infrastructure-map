# Content ideas

Backlog of content strategy ideas to pick up later. Newest at the top. Nothing here is scheduled yet.

## 2026-09-30: Data visualizations

**Experiment live 2026-09-30:** [/charts/](https://strategicenergymap.org/charts/) with four charts (oil flows per chokepoint, Hormuz
bypass capacity, tanker traffic, diesel since the crisis) and two chart posts. Judge at the growth check-in: chart-page
visits, search impressions for `/charts/`, and Bluesky link clicks and engagement on the chart posts compared with text posts.

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
