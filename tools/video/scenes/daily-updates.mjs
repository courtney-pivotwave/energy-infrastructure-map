/* Daily updates: ~2 min on how the map stays current and sourced — the Latest feed, confidence labels, events
 * on the map and the assets they affect, the events archive and RSS, and the sourcing rule on the About page.
 * Content changes daily, so everything shown is picked and read at record time.
 */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const VIEW = [[8, 25], [44, 66]]; // the Middle East, where most events sit
const KEEP = new Set(['oil', 'routes', 'choke', 'events', 'status']);
const daysAgo = d => (Date.now() - new Date(d + 'T00:00:00Z')) / 86400000;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The most recent pulsing event that sits on its own on the map and links to an asset, so it's a clean click. */
function pickEvent(events, infra) {
  const others = [...infra.chokepoints, ...infra.sites].map(x => x.coords || x.center).filter(Boolean);
  const onMap = events.filter(e => Array.isArray(e.coords) && daysAgo(e.date) <= 14);
  return onMap.filter(e => e.assets?.length)
    .filter(e => onMap.every(o => o === e || dist(o.coords, e.coords) > 0.6))
    .filter(e => others.every(c => dist(c, e.coords) > 0.5))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

export async function setup(v) {
  await v.page.evaluate(() => window.__vd.card('title', 'What changed in energy today, and how do we know?',
    'A sourced daily update on energy infrastructure, chokepoints and the conflicts that disrupt them.'));
  await v.page.evaluate(keep => {
    document.querySelectorAll('#layerList input[data-layer]').forEach(i => { if (i.checked !== keep.includes(i.dataset.layer)) i.click(); });
    document.querySelector('#collapseLeft').click();
  }, [...KEEP]);
  await v.wait(600);
  await v.page.evaluate(b => window.__map.fitBounds(b, { paddingTopLeft: [20, 70], paddingBottomRight: [400, 10] }), VIEW);
  await v.wait(1500);
}

export async function run(v) {
  const { events } = v.data('events');
  const infra = v.data('infrastructure');
  const ev = pickEvent(events, infra);

  await v.wait(4500);
  await v.hideCard();
  await v.say('Every morning an automated research agent reviews independent reporting since its last run, then updates events, facility status and prices.');

  // Latest
  const dated = await v.page.$eval('#tab-latest .situation > b', b => b.textContent.split('·')[1]?.trim());
  await v.highlight('#tab-latest .situation', 7000);
  await v.say(`The <b>Latest</b> tab leads with the situation in a paragraph, dated <b>${esc(dated)}</b>.`);
  await v.say('Need context? The background explains how we got here.', { hold: 0 });
  await v.click('#tab-latest .situation summary', { keepCaption: true });
  await v.wait(3500);
  await v.click('#tab-latest .situation summary', { move: 300 });
  await v.cursorAway();

  // Anatomy of an event
  await v.scrollTo('#tab-latest .event', 'start');
  await v.highlight('#tab-latest .event', 8000);
  await v.say('Below it, every development gets a date, a category, a severity colour and a confidence label, with links to its sources.');
  await v.highlight('#tab-latest .event .conf', 6500);
  await v.say('<b>Confirmed</b> means two or more independent sources. <b>Reported</b>, one reputable source. <b>Unverified</b>, a claim by a party to the conflict.', { hold: 6500 });
  const unv = await v.page.evaluate(() => { const c = document.querySelector('#tab-latest .event .conf.unverified'); if (!c) return false; c.closest('.event').dataset.vd = 'unverified'; return true; });
  if (unv) {
    await v.scrollTo('[data-vd="unverified"]', 'start');
    await v.highlight('[data-vd="unverified"]', 7000);
    await v.say('Those claims appear only when the claim itself is news: attributed by name, marked unverified, and never turned into facts or figures.', { hold: 7000 });
  }
  await v.scrollTo('#tab-latest .situation', 'start');

  // Events on the map
  await v.say('On the map, recent events pulse, coloured by severity.');
  if (ev) {
    // Centre the event in the open map area so its tooltip has room to the right of it
    const [lat, lng] = ev.coords;
    await v.flyBounds([[lat - 5, lng - 9], [lat + 5, lng + 9]], 2.5);
    const pt = await v.point(ev.coords);
    await v.say('Hover one for the headline…', { hold: 0 });
    await v.hover(pt);
    await v.wait(3000);
    await v.say('…and click it to open the asset it affects.', { hold: 0 });
    await v.click(pt, { keepCaption: true, move: 200 });
    await v.cursorAway();
    await v.wait(1500);
    const verified = await v.page.$eval('#tab-detail .statusbox .note', n => n.textContent.replace('Verified', '').trim()).catch(() => null);
    await v.highlight('#tab-detail .detail', 8000);
    await v.say(`Each asset keeps its own status note and history of related developments.${verified ? ` This one was last verified <b>${esc(verified)}</b>.` : ''}`);
  }

  // Archive and RSS
  await v.say('Every event is also archived, month by month…', { hold: 0 });
  await v.wait(1200);
  await v.goto('/events/?notrack=1');
  await v.highlight('.answer', 4500);
  await v.say('…with the sources for each one, and an RSS feed to follow along.', { hold: 0 });
  await v.page.evaluate(() => { const a = document.querySelector('a[href="/events.xml"]'); if (a) a.dataset.vd = 'rss'; });
  await v.highlight('[data-vd="rss"]', 4000);
  await v.wait(3000);
  await v.scrollTo('h2', 'start');
  await v.wait(3500);

  // The rules
  await v.goto('/about.html?notrack=1');
  await v.scrollTo('#rule', 'start');
  await v.highlight('#rule', 9000);
  await v.say('One sourcing rule for every government that is party to a conflict: verify, then use. Ship traffic in contested waters comes only from independent trackers.', { hold: 8000 });
  await v.scrollTo('#agent', 'start');
  await v.highlight('#agent ul', 7000);
  await v.say('Routine updates publish automatically. Big changes, like a chokepoint changing status, wait for human review.');
  await v.say('Significant developments are also posted to X and Bluesky, under the same rules.');

  await v.card('end', 'Stay up to date on the latest energy supply developments',
    'Visit and explore the live map: sourced daily updates, chokepoint traffic, pump prices and What-if scenarios. Free and ad-free.', 7000);
}
