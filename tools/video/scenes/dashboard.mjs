/* Dashboard: ~1.5 min down /dashboard/ — the headline figures, chokepoint traffic, pump prices, infrastructure
 * status, the event log, exposure, and the free downloads and citation at the end.
 * Every number is read from the rendered page at record time.
 */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// "+42% since 23 Feb" → "up 42%"; "−98% against the Sep–Feb average" → "down 98%"
const change = t => { const m = String(t).match(/([+−-])\s?(\d+(?:\.\d+)?)%/); return m ? `${m[1] === '+' ? 'up' : 'down'} ${m[2]}%` : ''; };
const CHOKEPOINT = 'bab-el-mandeb'; // a second strait to chart (the page opens on Hormuz)

/** Scroll a section to the top of the view, clear of the page's sticky section bar. */
async function to(v, selector, clear = 70) {
  await v.clearCaption(); // a caption about the last section shouldn't ride along into the next
  await v.page.evaluate(([s, c]) => {
    const el = document.querySelector(s);
    if (el.querySelector(':scope > [data-vd-anchor]')) return;
    const m = document.createElement('i');
    m.dataset.vdAnchor = '';
    m.style.cssText = `position:absolute;height:0;margin-top:-${c}px`;
    el.prepend(m);
  }, [selector, clear]);
  await v.scrollTo(`${selector} > [data-vd-anchor]`, 'start');
}

/** Headline tiles: label, value, unit and the line under it. */
const kpis = v => v.page.$$eval('#kpis .kpi', ks => ks.map(k => ({
  label: k.querySelector('.kpi-l')?.childNodes[0]?.textContent.trim() || '', value: k.querySelector('.kpi-v')?.childNodes[0]?.textContent.trim() || '',
  unit: k.querySelector('.kpi-v small')?.textContent.trim() || '', note: k.querySelector('.kpi-d')?.textContent.trim() || '',
})));

export async function setup(v) {
  await v.goto('/dashboard/?notrack=1');
  await v.page.waitForFunction(() => document.querySelector('#cpChart svg') && document.querySelector('#assetCards .asset') && document.querySelector('#evChart rect[data-w]'));
  await v.page.evaluate(() => window.__vd.card('title', 'The 2026 energy crisis in numbers',
    'One page of live figures on shipping, prices, infrastructure and events, free to download.', 'strategicenergymap.org/dashboard'));
  await v.wait(1500);
}

export async function run(v) {
  await v.wait(4500);
  await v.hideCard();

  // Overview
  const k = await kpis(v), tile = l => k.find(x => x.label.startsWith(l));
  const brent = tile('Brent'), hormuz = tile('Hormuz');
  await v.highlight('#kpis', 11000);
  await v.say('Every headline figure of the crisis on one page, each measured against the week before it began.');
  await v.say(`Brent is at <b>$${esc(brent.value)}</b> a barrel, ${esc(change(brent.note))} on that week. Tanker traffic through the Strait of Hormuz is <b>${esc(change(hormuz.note))}</b>.`);

  // Chokepoint traffic
  await to(v, '#chokepoints');
  await v.highlight('#cpChart', 6000);
  await v.say('<b>Chokepoint traffic</b>: tankers a day through each strait, against the average before the crisis.');
  await v.say('Select any row to chart it…', { hold: 0 });
  await v.click(`#cpTable tr[data-id="${CHOKEPOINT}"] td:nth-child(3)`, { keepCaption: true }); // a number cell: the name is a link
  await v.cursorAway();
  await v.wait(900);
  const name = (await v.text('#cpTitle')).split(':')[0];
  const cp = await v.text('#cpCallout');
  await v.say(`…here ${esc(name)}, <b>${esc(change(cp))}</b>.`);

  // Prices
  await to(v, '#prices');
  await v.say('<b>Prices</b>: weekly pump prices for the US, every EU country and the UK, from official statistics.');
  await v.say('Compare the countries where fuel has risen most…', { hold: 0 });
  await v.click('#presetSeg [data-v="rises"]', { keepCaption: true });
  await v.cursorAway();
  await v.wait(3200);
  await v.say('…or see every price in US dollars a litre.', { hold: 0 });
  await v.click('#measureSeg [data-v="usd"]', { keepCaption: true });
  await v.cursorAway();
  await v.wait(3200);

  // Infrastructure status
  await to(v, '#infrastructure');
  const assets = await v.page.$$eval('#assetCards .asset', a => a.length);
  await v.highlight('#statusBar', 7000);
  await v.say(`<b>Infrastructure status</b>: ${assets} assets have a live disruption. Each card gives the status, when it began, a confidence label and the sources.`);

  // Event log
  await to(v, '#events');
  const events = tile('Sourced events');
  await v.say(`<b>Event log</b>: all ${esc(events.value)} sourced events since the war began, by week and severity.`);
  // the busiest week: each week has a full-height click target whose tooltip gives its count ("Week of …: 24 events")
  const bar = await v.page.$$eval('#evChart rect[data-w]', rs => {
    const count = r => Number((r.querySelector('title')?.textContent.match(/: (\d+) event/) || [])[1] || 0);
    const b = rs.sort((p, q) => count(q) - count(p))[0].getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height * 0.6 };
  });
  await v.say('Select a week in the chart…', { hold: 0 });
  await v.click(bar, { keepCaption: true });
  await v.cursorAway();
  await v.wait(1500);
  await v.highlight('#evList', 6000);
  await v.say('…and the log below narrows to that week, each event with its confidence label and sources.');

  // Exposure
  await to(v, '#exposure');
  await v.highlight('#expo', 7000);
  await v.say('<b>Exposure</b>: the oil that normally moves through each chokepoint, and how little of it spare pipelines could carry around a closure.');

  // Data and citation
  await to(v, '#data');
  const sets = await v.page.$$eval('.datasets .ds', d => d.length);
  await v.highlight('.datasets', 8000);
  await v.say(`<b>Data &amp; sources</b>: all ${sets} datasets are free to download as CSV or JSON, at stable addresses, under a Creative Commons licence.`, { hold: 0 });
  await v.wait(2500);
  await v.hover('.datasets .ds .tool');
  await v.wait(4500);
  await v.scrollTo('.codebox', 'center');
  await v.say('Quoting a figure? Copy a ready-made citation.', { hold: 0 });
  await v.click('[data-copy="citeText"]', { keepCaption: true });
  await v.cursorAway();
  await v.wait(3000);

  await v.card('end', 'The 2026 energy crisis in numbers',
    'Shipping, prices, infrastructure and events, updated daily. Free to use and reuse.', 7000, 'strategicenergymap.org/dashboard');
}
