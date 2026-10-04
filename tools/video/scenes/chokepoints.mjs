/* Chokepoints: ~2 min on ship traffic through the world's energy chokepoints — the Chokepoints tab, the
 * ranking against the pre-crisis baseline, a chokepoint's detail view, why satellite counts can understate
 * Hormuz traffic, and the chokepoint's own sourced page. PortWatch numbers are read from the rendered page.
 */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const words = n => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? String(n);
const short = name => name.replace(/^Strait of /, '').replace(/\s*\([^)]*\)/g, '');
const minus = p => p.replace(/^-/, '−'); // typographic minus in captions

const HORMUZ = 'strait-of-hormuz';
const MANDEB = 'bab-el-mandeb';
const WORLD = [[-40, -110], [62, 150]];
// The story is shipping: keep routes, chokepoints and their status, switch the rest off before recording
const KEEP = new Set(['routes', 'choke', 'status']);

export async function setup(v) {
  await v.page.evaluate(() => window.__vd.card('title', 'How much shipping still gets through the world’s energy chokepoints?',
    'Daily ship counts from satellite tracking, compared with the weeks before the crisis.'));
  await v.page.evaluate(keep => {
    document.querySelectorAll('#layerList input[data-layer]').forEach(i => { if (i.checked !== keep.includes(i.dataset.layer)) i.click(); });
    document.querySelector('#collapseLeft').click();
  }, [...KEEP]);
  await v.wait(600);
  await v.page.evaluate(b => window.__map.fitBounds(b, { paddingTopLeft: [20, 70], paddingBottomRight: [400, 10] }), WORLD);
  await v.wait(1500);
}

/** Tankers a day, baseline and change from a chokepoint's live block or card. */
const stats = (v, sel) => v.page.$eval(sel, el => {
  const b = [...el.querySelectorAll('.cp-stats b')].map(x => x.textContent.trim());
  return { now: b[0], base: b[1], pct: el.querySelector('.cp-stats span:nth-child(3)')?.textContent.trim() };
});

export async function run(v) {
  const infra = v.data('infrastructure');
  const tracked = Object.values(v.data('scenarios').chokepoints).filter(c => c.portwatch).length;

  await v.wait(4500);
  await v.hideCard();
  await v.say(`The map marks ${words(infra.chokepoints.length)} shipping chokepoints. For ${words(tracked)} of them it shows daily ship counts from IMF PortWatch satellite tracking.`);

  // The Chokepoints tab
  await v.click('.tabs [data-tab="chokepoints"]');
  await v.wait(500);
  const label = await v.page.$eval('#tab-chokepoints .cp .spark + .note', n => n.textContent.match(/dashed = (.+?) avg/)?.[1]);
  const last = await v.page.$eval('#tab-chokepoints .cp .spark + .note span:last-child', n => n.textContent.trim());
  await v.highlight(`#tab-chokepoints [data-cp="${HORMUZ}"]`, 9500);
  await v.say(`Each card shows tankers a day, averaged over 7 days, against the pre-crisis baseline: the dashed line, the ${esc(label)} average.`);
  await v.say(`Satellite data lags about a week. The latest counts here run to <b>${esc(last)}</b>.`);

  // Ranking
  const cards = await v.page.$$eval('#tab-chokepoints .cp', cs => cs.map(c => ({
    id: c.dataset.cp, name: c.querySelector('.cp-name').textContent, pct: c.querySelector('.cp-stats span:nth-child(3)')?.textContent.trim(),
  })).filter(c => c.pct));
  cards.sort((a, b) => parseFloat(a.pct) - parseFloat(b.pct));
  await v.page.evaluate(() => { const cs = document.querySelectorAll('#tab-chokepoints .cp'); cs[cs.length - 1].dataset.vd = 'lastcp'; });
  await v.say(`Against that baseline: ${cards.map(c => `${esc(short(c.name))} <b>${esc(minus(c.pct))}</b>`).join(', ')}.`, { hold: 0 });
  await v.scrollTo('[data-vd="lastcp"]', 'start');
  await v.wait(3800);
  await v.scrollTo(`#tab-chokepoints [data-cp="${cards[0].id}"]`, 'start');
  await v.wait(2500);

  // One chokepoint up close
  await v.say('Click one to fly there and see its status, sources and full transit chart.', { hold: 0 });
  await v.click(`#tab-chokepoints [data-cp="${MANDEB}"] .cp-name`, { keepCaption: true });
  await v.cursorAway();
  await v.wait(2500);
  await v.page.waitForSelector('#cpLive .cp-stats');
  const m = await stats(v, '#cpLive');
  await v.highlight('#cpLive', 6000);
  await v.say(`Bab el-Mandeb: <b>${esc(m.now)}</b> tankers a day against a baseline of ${esc(m.base)} (${esc(minus(m.pct))}).`);

  // Hormuz, and what satellites miss
  await v.click('#tab-detail [data-back]');
  await v.click(`#tab-chokepoints [data-cp="${HORMUZ}"] .cp-name`);
  await v.cursorAway();
  await v.page.waitForSelector('#cpLive .cp-stats');
  const h = await stats(v, '#cpLive');
  const below = h.pct.startsWith('-') ? `${h.pct.slice(1)} below` : `${h.pct.replace('+', '')} above`;
  await v.highlight('#cpLive', 6500);
  await v.say(`At Hormuz, satellite tracking counts just <b>${esc(h.now)}</b> tankers a day, ${esc(below)} the baseline of ${esc(h.base)}.`);
  await v.highlight('#tab-detail .statusbox', 9000);
  await v.say('But some ships now sail with their transponders off, so tracked counts can understate traffic. The status note adds what sourced reporting shows.', { hold: 8000 });

  // Its own page
  await v.say('Every chokepoint also has its own page…', { hold: 0 });
  await v.wait(1500);
  await v.clickLink('#tab-detail a[href*="/chokepoints/"]', { pause: 500 });
  await v.cursorAway();
  await v.highlight('.answer', 7500);
  await v.say('…opening with a dated, sourced answer: is the strait open, and how much traffic is getting through.');
  await v.say('Then key figures, the What-if impact, recent developments and an FAQ: easy to cite or share.', { hold: 0 });
  await v.scrollTo('.fact-table', 'start');
  await v.wait(2800);
  await v.scrollTo('.faq', 'start');
  await v.wait(3500);

  await v.card('end', 'Stay up to date on the latest energy supply developments',
    'Visit and explore the live map: sourced daily updates, chokepoint traffic, pump prices and What-if scenarios. Free and ad-free.', 7000);
}
