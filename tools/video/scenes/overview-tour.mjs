/* Overview tour: a ~2.5 min walk around the whole map — layers, status, assets, the Latest feed, live
 * chokepoint traffic and pump prices. What-if has its own video (what-if-hormuz), so it isn't covered here.
 * Numbers are read from data/ or the rendered page.
 */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ASSET = 'yanbu-terminal'; // isolated on the Red Sea coast, so it's an easy, unambiguous click
const EUROPE = [[34, -12], [66, 45]];
const MIDEAST = [[10, 30], [42, 64]];
const WORLD = [[-45, -130], [70, 150]];

export async function setup(v) {
  await v.page.evaluate(() => window.__vd.card('title', 'A quick tour of the Strategic Energy Infrastructure Map',
    'Pipelines, terminals and chokepoints worldwide, and what is happening to them now.'));
  await v.wait(1500);
}

export async function run(v) {
  const infra = v.data('infrastructure');
  const site = infra.sites.find(s => s.id === ASSET);

  await v.wait(4500);
  await v.hideCard();
  await v.say(`One map of the world’s oil and gas infrastructure: ${infra.pipelines.length} major pipelines, ${infra.fields.length} oil and gas fields, ${infra.sites.length} ports, refineries, LNG terminals and production sites, and ${infra.chokepoints.length} shipping chokepoints.`);

  // Top bar
  const brent = await v.page.$eval('#ticker .tick', t => ({ v: t.querySelector('b')?.textContent, pct: t.querySelector('.up, .down')?.textContent }));
  await v.highlight('#ticker', 6000);
  await v.say(`Benchmark prices run along the top, measured against the week before the crisis. Brent is at <b>$${esc(brent.v)}</b>, ${esc(brent.pct?.replace('▲', 'up ').replace('▼', 'down '))}.`);
  await v.highlight('.brand-sub', 4000);
  await v.say('Every dataset shows how fresh it is.');

  // Layers and status
  await v.highlight('#layerList', 7000);
  await v.say('Switch layers on and off: pipelines, fields, refineries, LNG terminals, ports and chokepoints.', { hold: 0 });
  await v.click('#layerList input[data-layer="gas"]', { keepCaption: true });
  await v.wait(1200);
  await v.click('#layerList input[data-layer="gas"]', { keepCaption: true, move: 300 });
  await v.wait(2500);

  const flagged = await v.page.$eval('#layerList input[data-layer="status"]', i => i.closest('label').querySelector('.count')?.textContent.trim());
  await v.highlight('#statusLegend', 7000);
  await v.say(`Rings mark assets that aren’t operating normally: closed, damaged, offline, disrupted or reduced. <b>${esc(flagged)}</b> are flagged right now.`);

  await v.say('Hide the panel whenever you want more room.', { hold: 0 });
  await v.click('#collapseLeft', { keepCaption: true });
  await v.wait(2200);

  // Regions and assets
  await v.say('Jump straight to a region…', { hold: 0 });
  await v.click('#regions [data-region="mideast"]', { keepCaption: true });
  await v.wait(1200);
  const pt = await v.page.evaluate(ll => { const p = window.__map.latLngToContainerPoint(ll); return { x: p.x, y: p.y }; }, site.coords);
  await v.say('…and click any asset.', { hold: 0 });
  await v.click(pt, { keepCaption: true });
  await v.wait(600);
  await v.cursorAway();
  await v.highlight('#tab-detail .detail', 7500);
  await v.say(`${esc(site.name)}: what it does, its current status and related developments, with sources and a confidence label for every claim.`);

  // Latest
  await v.click('.tabs [data-tab="latest"]');
  await v.highlight('#tab-latest .situation', 6000);
  await v.say('The <b>Latest</b> tab is a daily, sourced feed of what’s changing, led by a summary of the situation.');
  await v.say('Filter it by time window or category…', { hold: 0 });
  await v.click('#tab-latest [data-cat="shipping"]', { keepCaption: true });
  await v.wait(1500);
  await v.say('…and click an event to see where it happened.', { hold: 0 });
  await v.click('#tab-latest .event .ev-title', { keepCaption: true });
  await v.wait(2500);

  // Chokepoints
  await v.click('.tabs [data-tab="chokepoints"]');
  await v.flyBounds(MIDEAST, 2.5);
  await v.highlight('#tab-chokepoints .cp', 7000);
  await v.say('<b>Chokepoints</b> shows daily tanker transits from IMF PortWatch satellite data, against the pre-crisis baseline. Counts lag about a week.');
  const cp = await v.page.$eval('#tab-chokepoints .cp', c => c.querySelector('.cp-name')?.textContent);
  await v.say(`Click one for its full story: here, ${esc(cp)}.`, { hold: 0 });
  await v.click('#tab-chokepoints .cp .cp-name', { keepCaption: true });
  await v.cursorAway();
  await v.wait(3500);

  // Pump prices
  await v.click('.tabs [data-tab="fuel"]');
  await v.flyBounds(EUROPE, 3);
  await v.say('<b>Pump prices</b>: weekly petrol and diesel prices for the US, every EU country and the UK, from official statistics.');
  const kpi = await v.page.$eval('#tab-fuel .impact .kpi', k => ({ v: k.querySelector('.v')?.childNodes[0]?.textContent.trim(), unit: k.querySelector('.v small')?.textContent.trim(), k: k.querySelector('.k')?.textContent }));
  const pct = kpi.k?.match(/([+-]\d+%)/)?.[1];
  await v.highlight('#tab-fuel .impact .kpi', 5000);
  await v.say(`US gasoline: <b>${esc(kpi.v)} ${esc(kpi.unit)}</b>${pct ? `, ${esc(pct.replace('+', 'up '))} since February` : ''}.`);
  await v.say('Click any country for its price history.', { hold: 0 });
  await v.click(v.page.locator('#tab-fuel tr[data-fuel]', { hasText: 'France' }), { keepCaption: true });
  await v.wait(600);
  await v.cursorAway();
  await v.wait(3500);

  await v.flyBounds(WORLD, 3.5);
  await v.say('Updated every day by a research agent, with a source behind every claim. Free, and no ads.', { hold: 5000 });

  await v.card('end', 'Stay up to date on the latest energy supply developments',
    'Visit and explore the live map: sourced daily updates, chokepoint traffic, pump prices and What-if scenarios. Free and ad-free.', 7000);
}
