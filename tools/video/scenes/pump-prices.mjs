/* Pump prices: ~2 min on weekly petrol and diesel prices — the price map, US/EU/UK headline numbers, the
 * country ranking, petrol vs diesel and US$/litre, a country's history, US regions and a price page.
 * Every number is read from the rendered page or data/fuel.json at record time.
 */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// "4.46" + "$/gal" → "$4.46 a gallon"; "2.10" + "€/l" → "€2.10 a litre"
const money = (val, unit) => {
  const m = String(unit).match(/^([$€£])\/(gal|l)$/);
  return m ? `${m[1]}${val} a ${m[2] === 'gal' ? 'gallon' : 'litre'}` : `${val} ${unit}`;
};
const the = name => /^(United |Netherlands|Czech Republic)/.test(name) ? `the ${name}` : name;
const sincePct = b => Math.round((b.now - b.pre_crisis) / b.pre_crisis * 100); // rounded as the table rounds it
const up = p => p?.startsWith('-') ? `down ${p.slice(1)}` : `up ${String(p).replace('+', '')}`;

const NORTH_ATLANTIC = [[18, -126], [66, 40]]; // the US and Europe in one view
const EUROPE = [[35, -11], [66, 33]];
const COUNTRY = 'de';
const REGION = 'us-california';

export async function setup(v) {
  await v.page.evaluate(() => window.__vd.card('title', 'How much more are drivers paying since the crisis began?',
    'Weekly pump prices for the US, every EU country and the UK, from official statistics.'));
  await v.page.evaluate(() => { // a bare map: the price layer appears when the tab opens
    document.querySelectorAll('#layerList input[data-layer]').forEach(i => { if (i.checked) i.click(); });
    document.querySelector('#collapseLeft').click();
  });
  await v.wait(600);
  await v.page.evaluate(b => window.__map.fitBounds(b, { paddingTopLeft: [20, 70], paddingBottomRight: [400, 10] }), NORTH_ATLANTIC);
  await v.wait(1500);
}

/** Headline cards: value, unit, label and change since February. */
const kpis = v => v.page.$$eval('#tab-fuel .impact .kpi', ks => ks.map(k => ({
  v: k.querySelector('.v')?.childNodes[0]?.textContent.trim(), unit: k.querySelector('.v small')?.textContent.trim(),
  label: k.querySelector('.k')?.textContent.split('·')[0].trim(), pct: k.querySelector('.k b')?.textContent.trim(),
})));
/** The country table, top to bottom (it is sorted by the rise since February). */
const ranking = v => v.page.$$eval('#tab-fuel > .fuel-table tbody tr', rs => rs.map(r => ({
  name: r.cells[0].childNodes[0].textContent.trim(), pct: r.cells[2].textContent.trim(),
})));

export async function run(v) {
  const fuel = v.data('fuel');
  const entry = id => fuel.entries.find(e => e.id === id);

  await v.wait(4500);
  await v.hideCard();
  await v.say('Open <b>Pump prices</b>…', { hold: 0 });
  await v.click('.tabs [data-tab="fuel"]', { keepCaption: true });
  await v.cursorAway();
  await v.say('…and every country’s price appears on the map, shaded by how far it has risen since the week before the crisis.');

  // Headline numbers
  const k = await kpis(v);
  await v.highlight('#tab-fuel .impact', 12000);
  await v.say(`In the US, gasoline averages <b>${esc(money(k[0].v, k[0].unit))}</b>, ${esc(up(k[0].pct))} since February. Diesel is ${esc(money(k[1].v, k[1].unit))}, ${esc(up(k[1].pct))}.`);
  await v.say(`EU average petrol: <b>${esc(money(k[2].v, k[2].unit))}</b> (${esc(k[2].pct)}). UK diesel: <b>${esc(money(k[3].v, k[3].unit))}</b> (${esc(k[3].pct)}).`);

  // Ranking, product, unit
  let r = await ranking(v);
  await v.highlight('#tab-fuel > .fuel-table', 7000);
  await v.say(`The table ranks every country by how far prices have risen. For diesel, ${esc(the(r[0].name))} leads at <b>${esc(r[0].pct)}</b>, then ${esc(the(r[1].name))} and ${esc(the(r[2].name))}.`);
  await v.say('Switch to petrol…', { hold: 0 });
  await v.click('#tab-fuel [data-product="petrol"]', { keepCaption: true });
  await v.wait(800);
  r = await ranking(v);
  await v.say(`…where ${esc(the(r[0].name))} is up the most, <b>${esc(r[0].pct)}</b>.`);
  await v.say('Or compare every country in US dollars a litre, at ECB exchange rates.', { hold: 0 });
  await v.click('#tab-fuel [data-unit="usd"]', { keepCaption: true });
  await v.wait(3500);
  const note = await v.text('#tab-fuel > p.note');
  if (/taxes, not crude costs/.test(note)) {
    await v.page.evaluate(() => { const n = document.querySelector('#tab-fuel > p.note'); n.dataset.vd = 'note'; });
    await v.scrollTo('[data-vd="note"]', 'center');
    await v.highlight('[data-vd="note"]', 5000);
    await v.say('Much of the gap between countries comes from taxes, not crude costs.');
    await v.scrollTo('#tab-fuel .impact', 'start');
  }
  await v.click('#tab-fuel [data-unit="local"]');

  // A country up close
  await v.flyBounds(EUROPE, 3);
  const de = entry(COUNTRY);
  await v.say('Hover any country for its latest price…', { hold: 0 });
  await v.hover(await v.point(de.coords));
  await v.wait(2500);
  await v.say('…or click it for the detail.', { hold: 0 });
  await v.click(await v.point(de.coords), { keepCaption: true, move: 200 });
  await v.cursorAway();
  await v.wait(1500);
  await v.highlight('#tab-detail .geo', 7000);
  await v.say(`${esc(de.name)}: petrol at <b>${esc(money(de.petrol.now.toFixed(2), de.unit))}</b>, ${esc(up((sincePct(de.petrol) >= 0 ? '+' : '') + sincePct(de.petrol) + '%'))} since February. The chart shows a year of weekly prices against the February level.`);

  // US regions
  await v.click('#tab-detail [data-back]');
  await v.page.evaluate(() => { document.querySelector('#tab-fuel details.sc-section').dataset.vd = 'regions'; });
  await v.scrollTo('[data-vd="regions"]', 'center');
  await v.say('The US is also broken down by region.', { hold: 0 });
  await v.click('[data-vd="regions"] summary', { keepCaption: true });
  await v.wait(1500);
  await v.scrollTo(`[data-vd="regions"] tr[data-fuel="${REGION}"]`, 'center');
  await v.click(`[data-vd="regions"] tr[data-fuel="${REGION}"]`, { keepCaption: true });
  await v.cursorAway();
  await v.wait(1200);
  const ca = entry(REGION);
  const regions = fuel.entries.filter(e => e.group === 'us-region' && e.diesel);
  const highest = regions.every(e => e.diesel.now <= ca.diesel.now);
  const fmt = n => `$${n.toFixed(2)}`;
  await v.highlight('#tab-detail .detail', 7000);
  await v.say(`${esc(ca.name)}: regular gasoline at <b>${fmt(ca.petrol.now)}</b> a gallon and diesel at <b>${fmt(ca.diesel.now)}</b>${highest ? ', the highest of any US region' : ''}.`);

  // Its own page
  await v.say('Every country and region also has its own page…', { hold: 0 });
  await v.wait(1200);
  await v.clickLink('#tab-detail a[href^="/fuel-prices/"]', { pause: 500 });
  await v.cursorAway();
  await v.highlight('.answer', 7000);
  await v.say('…opening with a dated answer from the official source, then the weekly trend, the data and an FAQ.', { hold: 0 });
  await v.wait(6000);
  await v.scrollTo('.chart', 'start');
  await v.wait(3000);
  await v.scrollTo('.faq', 'start');
  await v.wait(3000);

  await v.card('end', 'Stay up to date on the latest energy supply developments',
    'Visit and explore the live map: sourced daily updates, chokepoint traffic, pump prices and What-if scenarios. Free and ad-free.', 7000);
}
