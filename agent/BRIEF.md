# Brief: week of Oct 5, 2026

Covers Sep 28–Oct 4. Merge this PR to approve it, or edit any line first. Closing it skips a week: the Newsdesk keeps
following the last merged brief.

## The week in brief
Bluesky grew from 1 follower to 11 on 22 posts, and the daily update ran 7 of 7 days. Search, X and visitor numbers
weren't collected, so we can't tell yet whether any of it brings people to the site. The clearest problem is timing:
the posting queue clears about 4 posts a day, but the Newsdesk drafted up to 5, so 14 of 22 posts went out a day late,
and on Oct 2 and Oct 3 every event post went out the day after a digest that had already reported it. This week:
draft at most 4 posts a day and don't give a digest's lead story its own event post.

## Scorecard
| Metric | Week ending Oct 4 | Baseline Sep 29 | Source |
|---|---|---|---|
| Bluesky followers | 11 | 1 | metrics `social.bluesky`; growth log baseline |
| Bluesky interactions | 11 on 22 posts (6 likes, 5 reposts, 0 replies) | — | metrics `social.bluesky` |
| X followers | not collected (X_READS off) | 0 | metrics `sources.x`; growth log baseline |
| X impressions / link clicks | not collected (X_READS off) | — | metrics `sources.x` |
| Google clicks / impressions | not collected (GSC_SERVICE_ACCOUNT secret missing) | 0 / 0 | metrics `sources.google`; growth log |
| Bing clicks / impressions | not collected (BING_WEBMASTER_KEY secret missing) | 0 / 0 | metrics `sources.bing`; growth log |
| Site visitors | not collected (Vercel last entered for week ending Sep 29) | 70 (incl. owner) | `metrics/vercel.json`; growth log |
| Pages in sitemap | 135 (136 after the dashboard merged on Oct 5) | 130 | metrics `site`; `dist/sitemap.xml`; growth log |
| Daily updates | 7/7 | — | metrics `agents.daily_update_runs` |
| PRs waiting (oldest) | 2 (#2, open since Oct 1, 4 days today) | — | GitHub, Oct 5 |

There's no earlier metrics file, so the comparison column is the Sep 29 baseline in `docs/growth-log.md`.

## What we learned
1. **Posts go out a day late.** 8 of 22 posts went out the day they were drafted: all 5 digests, but only 2 of 8 event
   posts and none of 4 explainers. On Oct 3 and Oct 4 the queue sent 4 posts a day (metrics `posted_at`), against 4–5
   drafts a day, so each day's backlog pushed the next day's posts back. Sure: this is what the timestamps show.
2. **Event posts repeat the digest.** The Oct 2 digest led with the Iran sanctions and the diesel reserves, and the
   Oct 3 digest with the six Hormuz strikes and the Saudi offensive. All four stories then went out again as event
   posts the following day (`data/social.json`). Sure.
3. **Followers are growing, but engagement is too thin to rank.** 9 of 22 Bluesky posts got any interaction. By type:
   events 4 on 8 posts, charts 3 on 4, the launch post 2 on 1, digests 1 on 5, explainers 1 on 4. Every type has fewer
   than 10 posts, so this is too little to rank post types. No mix changes based on it.
4. **We can't see whether posting leads to visits.** Search, X and Vercel numbers are all missing for this week, so
   neither the charts experiment nor the X-links trial can be judged yet (see Experiments).
5. **New features went unannounced.** The walkthrough videos, Tour button and "Embed the map" section shipped Oct 3,
   and the dashboard with CC BY 4.0 downloads merged Oct 5. None had a post; the only announcement so far is the
   launch post (`agents.other_commits`, `social.drafted_by_type`).

## Priorities
1. **Newsdesk:** get each day's posts out the same day (Newsdesk notes below).
2. **The owner:** connect the missing measurements (Search Console, Bing, this week's Vercel numbers) so that next
   week's brief can say whether the site is reaching people. Without them, both experiments stall.
3. **The owner:** clear the two review PRs (#2, #3), which frees Studio to start next week.

## Studio assignments
None this week. Two PRs are waiting and #2 has been open 4 days (EDITOR.md rule 4).
Held: dashboard follow-ups from `docs/content-ideas.md` (Asian pump prices, market benchmark history), chokepoint
pillars. They'll be considered once the review queue is clear.

## Newsdesk notes
- Draft at most 4 posts a day: the digest, at most 2 event posts, and the explainer (or the day's chart in its place
  on Mondays and Thursdays). The queue sends about 4 a day, so a fifth draft pushes the next day's posts back.
- Don't draft an event post about the story the digest leads with. Use the event slots for other qualifying events,
  or draft none.
- If yesterday's drafts haven't all posted when you run (no entry in `data/social-log.json`), draft only the digest
  and the explainer that day.
- Otherwise no change to the mix or tags.

## Experiments
| Experiment | Started | Judge on | Measure | This week's call |
|---|---|---|---|---|
| /charts/ section and chart posts | Sep 30 | Nov 2 | `/charts/` visits (Vercel), `/charts/` search impressions, Bluesky engagement on chart posts vs other posts | Continue. 4 chart posts with 3 interactions is too few to judge, and visits and search aren't collected yet |
| Links in X explainer posts (two-week trial) | Sep 29 | Oct 12 | X impressions and link clicks on explainers vs unlinked posts | Continue. X reads are off; without them the call on Oct 12 will be an extension |
| Same-day posting (cap at 4 drafts, no digest repeats) | Oct 5 | Oct 19 | share of posts with `days_after_draft` 0 (8 of 22 this week); Bluesky interactions per post (11 on 22) | New |

## For the owner
- [ ] Review PR #2 "Source review: October 2026" (open since Oct 1) (~20 min)
- [ ] Review PR #3 "Review: Add Riyadh Refinery after fire, Houthi strike claim" (open since Oct 4) (~10 min)
- [ ] Add the `GSC_SERVICE_ACCOUNT` and `BING_WEBMASTER_KEY` secrets to the Weekly metrics workflow (~20 min)
- [ ] Copy last week's Vercel numbers into `metrics/vercel.json` with `week_ending` 2026-10-04 (~5 min)
- [ ] Decide whether to set `X_READS=1` (X bills API reads). It's needed to judge the X-links trial on Oct 12 (~2 min)
- [ ] Optional: draft an announcement post for the dashboard and its free CC BY 4.0 downloads, and one for the
      embeddable map. The Newsdesk's instructions don't cover announcements (~15 min)
- [ ] Optional outreach: open-data and data-journalism newsletters and resource lists, with the pitch "free,
      sourced, daily-updated energy chokepoint and pump price datasets, CC BY 4.0, CSV/JSON" (~30 min)

## Not this week
- New Studio work: held by the review queue (rule 4).
- Post-type or hashtag changes: too few posts and interactions to rank (rule 2).
- Search-driven page fixes: no search data collected.
- Pages added since the baseline: no traffic numbers to judge them by.

## Questions for the owner
- Announcement posts aren't covered by `agent/UPDATE_AGENT.md`, so new features only get a post if you write one.
  Should the Newsdesk draft an announcement post (in a PR) when a site feature merges? That would be a rule change.

## Coming up
- Oct 12: judge the X-links trial; next metrics file (Mondays 09:07 UTC); next brief.
- Oct 19: judge same-day posting.
- Oct 29: monthly growth snapshot and AI citation check (a month after the Sep 29 baseline).
- Nov 2: judge the charts experiment.
- November: next monthly source review (October's is PR #2).
