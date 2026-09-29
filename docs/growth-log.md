# Growth log

Monthly snapshot of reach and agent reliability, to show how a fully agent-run site grows from zero. Numbers that platforms keep history for (Search Console, Bing, X analytics) can be re-pulled later; the rest has to be written down on the day.

## Baseline: 2026-09-29

Site live on strategicenergymap.org since 2026-09-27. Distribution started today.

| Metric | Value | Source |
|---|---|---|
| Crawlable pages | 130 | sitemap.xml; submitted to Google (sitemap) and Bing (IndexNow, HTTP 200) |
| Google impressions / clicks | 0 / 0 | Search Console (verified 2026-09-27) |
| Bing impressions / clicks | 0 / 0 | Bing Webmaster Tools (imported 2026-09-29) |
| Visitors / page views (7 days to 2026-09-29) | 70 / 96, bounce 81% (includes owner's own visits; excluded from 2026-09-29 via ?notrack=1) | Vercel Web Analytics. Top pages: / 52, /chokepoints/strait-of-hormuz 7, /facilities 6, /events 4. Referrers: google.com 6, bing.com 1, t.co 1 |
| X @StratEnergyMap | 3 posts, 0 followers | x.com |
| Bluesky @strategicenergymap.org | 3 posts, 1 follower | public API |
| AI answer engines citing the site | see below | manual check |

**Agent track record:** 2 daily runs so far. Run 1 (2026-09-28) needed a human correction PR: wording was stronger than the sources supported, one belligerent claim was in the digest, and a private individual was named. The source policy and validator were tightened afterwards. Run 2 (2026-09-29) published without correction.

**Build:** v2 started 2026-09-27; 31 commits to date, all written by Claude Code or the scheduled agent under Courtney's direction.

### AI citation check

Ask each question in a fresh chat with web search on. Mark ✓ if strategicenergymap.org is cited or linked, ✗ if not. Repeat monthly with the same questions.

| # | Question | ChatGPT | Perplexity | Copilot | Google AI |
|---|---|---|---|---|---|
| 1 | Is the Strait of Hormuz open right now? | ✗ (Reuters, AOL, Straits Times) | ✗ (Sky, NBC, KCRA, CNBC, Guardian, global-energy-flow.com) | | |
| 2 | How many ships are going through the Strait of Hormuz? | | | | |
| 3 | Which pipelines bypass the Strait of Hormuz? | | | | |
| 4 | What is the capacity of Saudi Arabia's East-West pipeline? | | | | |
| 5 | Is Ras Tanura exporting oil? | | | | |
| 6 | How much have diesel prices gone up since the Hormuz closure? | | | | |
| 7 | What is the average price of diesel in Germany this week? | | | | |
| 8 | What happens to oil supply if Bab el-Mandeb closes too? | | | | |
| 9 | Is the Red Sea open to tankers? | | | | |
| 10 | Map of oil and gas infrastructure affected by the Iran war | | | | |
