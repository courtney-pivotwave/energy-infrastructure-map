/* Pilot: "What if the Strait of Hormuz shut completely?" — a ~90 s walkthrough of What-if mode.
 * Every number on screen is read from data/ or from the rendered panel at record time, so a re-record
 * after a data update stays accurate.
 */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = name => name.replace(/\s*\([^)]*\)/g, ''); // "East-West Pipeline (Petroline)" → "East-West Pipeline"
const words = n => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? String(n);
const list = xs => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

const HORMUZ = 'strait-of-hormuz';
const MANDEB = 'bab-el-mandeb';
const GULF = [[21.5, 43], [30.5, 58.5]];
const MIDEAST = [[10, 30], [42, 64]];
const CAPE_ROUTE = [[-38, -22], [44, 80]];
// Layers this story doesn't need: switching them off is the first tip in the video
const DECLUTTER = ['gas', 'oilfield', 'gasfield', 'production', 'refinery', 'events'];

export async function setup(v) {
  await v.page.evaluate(() => window.__vd.card('title', 'What if the Strait of Hormuz shut completely?',
    'A walkthrough of What-if mode: close a chokepoint and see what breaks.'));
  await v.wait(1500);
}

export async function run(v) {
  const sc = v.data('scenarios');
  const h = sc.chokepoints[HORMUZ];
  const demand = sc.globals.world_oil_demand_mbd;

  await v.wait(4500);
  await v.hideCard();
  await v.say('This map tracks the world’s oil and gas pipelines, export terminals and shipping chokepoints, with sourced daily updates.');

  // Simplify, then make room
  await v.say('Start by simplifying: switch off the layers this story doesn’t need, like gas pipelines, fields and recent events.', { hold: 0 });
  for (const key of DECLUTTER) {
    await v.click(`#layerList input[data-layer="${key}"]`, { keepCaption: true, move: 450, pause: 150 });
    await v.wait(250);
  }
  await v.wait(2200);
  await v.say('Then hide the panel to give the map more room.', { hold: 0 });
  await v.click('#collapseLeft', { keepCaption: true });
  await v.wait(2400);

  await v.flyBounds(MIDEAST, 3.2);
  await v.say(`In 2025 about <b>${h.oil_mbd} million barrels a day</b> of oil passed through the Strait of Hormuz: roughly ${Math.round(h.oil_mbd / demand * 100)}% of world demand.`);

  // Open What-if
  await v.click('.tabs [data-tab="scenario"]');
  const n = await v.page.locator('#tab-scenario .sc-list input').count();
  await v.highlight('#tab-scenario .sc-list', 3500);
  await v.say(`The <b>What-if</b> tab lets you close any of ${words(n)} major chokepoints, alone or together.`);

  // Close Hormuz
  await v.click(`#tab-scenario [data-close="${HORMUZ}"]`);
  await v.wait(600);
  await v.cursorAway();
  const cutOff = await v.page.$$eval('#tab-scenario .sc-section h5', hs => hs.map(h => h.textContent).find(t => /Assets cut off/.test(t))?.match(/\d+/)?.[0]);
  await v.say(`Close Hormuz. <b>Red dashes</b> are tanker and LNG routes that are cut, and ${cutOff} terminals, refineries and other assets are left stranded.`);

  await v.flyBounds(GULF, 3.5, { paddingTopLeft: [40, 80], paddingBottomRight: [410, 60] });
  const bypass = await v.page.$$eval('#tab-scenario .sc-section li:not(.warn) > a[data-asset]', as => as.map(a => a.textContent.trim()));
  await v.say(`<b style="color:#8fe0a9">Green</b> lines are the only bypass routes the model counts: ${list(bypass.map(short).map(esc))}.`);

  // The numbers
  await v.highlight('#tab-scenario .impact', 9000);
  const kv = await v.page.$$eval('#tab-scenario .impact .kpi', ks => ks.map(k => ({ v: k.querySelector('.v').textContent.trim(), k: k.querySelector('.k').textContent.trim() })));
  const pct = kv[0].k.match(/\(([\d.]+)%/)?.[1];
  await v.say(`Net result: a <b>${esc(kv[0].v)} mb/d</b> oil shortfall, ${esc(pct)}% of world demand, even after <b>${esc(kv[1].v)} mb/d</b> of pipeline bypass.`);
  await v.say(`And <b>${esc(kv[3].v)}</b> of global LNG trade has no way out at all.`);

  const days = (await v.text('#tab-scenario .impact + p.note')).match(/roughly (\d+) days/)?.[1];
  if (days) {
    await v.highlight('#tab-scenario .impact + p.note', 4500);
    await v.say(`IEA emergency stocks would cover that gap for about <b>${days} days</b>, if they could be released that fast. In practice, maximum release rates are far below a gap this size.`, { hold: 7000 });
  }

  // Live status feeds the model
  const warnings = await v.page.$$eval('#tab-scenario .sc-section .warn', ws => ws.map(w => {
    const m = w.textContent.match(/⚠\s*(.+?) is currently (\w+)/); return m && { name: m[1].trim().replace(/\s*\([^)]*\)/g, ''), st: m[2] };
  }).filter(Boolean));
  if (warnings.length) {
    await v.scrollTo('#tab-scenario .sc-section', 'start');
    await v.highlight('#tab-scenario .sc-section', 6000);
    const byStatus = {};
    warnings.forEach(w => { (byStatus[w.st] ||= new Set()).add(w.name); });
    const parts = Object.entries(byStatus).map(([st, names]) => `${list([...names].map(esc))} ${names.size > 1 ? 'are' : 'is'} <b>${esc(st)}</b>`);
    await v.say(`It also reads each facility’s live status. Right now ${list(parts)}, so real bypass capacity is likely lower.`, { hold: 6500 });
  }

  // Who is exposed
  const exposed = await v.page.$$eval('#tab-scenario .sc-section h5', hs => {
    const h = hs.find(x => /Most exposed/i.test(x.textContent));
    return h ? [...h.parentElement.querySelectorAll('li b')].map(b => b.textContent.trim()) : [];
  });
  if (exposed.length) {
    await v.page.evaluate(() => [...document.querySelectorAll('#tab-scenario .sc-section h5')].find(x => /Most exposed/i.test(x.textContent))?.parentElement.setAttribute('data-vd', 'exposed'));
    await v.scrollTo('[data-vd="exposed"]', 'start');
    await v.highlight('[data-vd="exposed"]', 5000);
    await v.say(`Most exposed: ${list(exposed.slice(0, 3).map(esc))}.`);
  }

  // Combine closures
  await v.scrollTo('#tab-scenario .sc-list', 'center');
  await v.click(`#tab-scenario [data-close="${MANDEB}"]`);
  await v.wait(500);
  await v.cursorAway();
  await v.flyBounds(CAPE_ROUTE, 3.8, { paddingTopLeft: [40, 80], paddingBottomRight: [410, 60] });
  const reroute = await v.page.$$eval('#tab-scenario .impact .kpi', ks => ks[2]?.textContent.match(/\+(\d+) days/)?.[1]);
  await v.say(`Closures combine. Add Bab el-Mandeb and Red Sea tankers divert around the Cape of Good Hope${reroute ? `, about <b>${reroute} extra days</b> at sea` : ''}.`);

  // Honest framing, then reset
  await v.click('#scenarioBar [data-sc-reset]');
  await v.wait(400);
  await v.cursorAway();
  await v.flyBounds(MIDEAST, 3);
  await v.say('What-if is an illustrative model of a total shutdown. The real strait’s status is tracked separately, with a source behind every claim.', { hold: 5500 });

  await v.card('end', 'Stay up to date on the latest energy supply developments',
    'Visit and explore the live map: sourced daily updates, chokepoint traffic, pump prices and What-if scenarios. Free and ad-free.', 7000);
}
