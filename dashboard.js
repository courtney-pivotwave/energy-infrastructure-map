// Data dashboard (/dashboard/). Renders /data/v1/dashboard.json, which scripts/build.mjs writes on every deploy.
// The page's HTML already carries the dated answer, key figures, benchmarks, downloads and FAQ; this adds the
// interactive panels. All text from data goes through esc(), all links through safeUrl().
(() => {
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch (e) { return '#'; } };
const T = d => Date.parse(d + 'T00:00:00Z');
const fmtDate = (d, o = { day: 'numeric', month: 'short', year: 'numeric' }) => new Date(T(d)).toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' });
const pct = (a, b) => (a == null || !b) ? null : (a - b) / b * 100;
const signed = (v, dp = 0) => v == null ? '—' : (v > 0.05 ? '+' : v < -0.05 ? '−' : '') + Math.abs(v).toFixed(dp) + '%';
const cls = v => v == null ? '' : v > 0.5 ? 'up' : v < -0.5 ? 'down' : '';
const n = (v, dp = 2) => v == null ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const PAL = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6'].map(v => `var(${v})`);
const STATUS = { closed: 'Closed', damaged: 'Damaged', offline: 'Offline', disrupted: 'Disrupted', reduced: 'Reduced' };
const SEV = ['critical', 'high', 'medium', 'low'];
const SEVC = { critical: 'var(--crit)', high: 'var(--high)', medium: 'var(--med)', low: 'var(--low)' };
const TYPE = { chokepoint: 'Chokepoint', pipeline: 'Pipeline', field: 'Field', site: 'Site', route: 'Route' };
const WAR = '2026-02-28', BASE = { from: '2025-09-01', to: '2026-02-27' };

// ── Toast, copy, panel tools ──
const toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2600); };
function copy(txt, label) {
  const fail = () => toast('Copy was blocked. Select the text and copy it manually.');
  try { navigator.clipboard.writeText(txt).then(() => toast(`${label} copied.`), fail); } catch (e) { fail(); }
}
const ICON = {
  csv: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 2v8m0 0 3-3m-3 3L5 7M3 13h10"/></svg>',
  cite: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 4h10M3 8h10M3 12h6"/></svg>',
  link: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M7 9a3 3 0 0 0 4 0l2-2a3 3 0 0 0-4-4l-1 1m1 3a3 3 0 0 0-4 0L3 9a3 3 0 0 0 4 4l1-1"/></svg>',
};
function tools(D) {
  document.querySelectorAll('[data-tools]').forEach(el => {
    const k = el.dataset.tools, sec = el.closest('section'), file = D.downloads[k];
    el.innerHTML = (file ? `<a class="tool" href="${esc(file)}" download>${ICON.csv}CSV</a>` : '') +
      `<button class="tool" type="button" data-cite="${esc(sec?.id || '')}">${ICON.cite}Cite</button><button class="tool" type="button" data-link="${esc(sec?.id || '')}">${ICON.link}Link</button>`;
  });
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-cite]'), l = e.target.closest('[data-link]'), cc = e.target.closest('[data-copy]');
    if (c) { const sec = document.getElementById(c.dataset.cite), title = sec?.querySelector('h2, h3')?.textContent.trim() || 'Data dashboard'; copy(`Strategic Energy Infrastructure Map, "${title}", data as of ${fmtDate(D.updated)}. ${location.origin}/dashboard/#${c.dataset.cite} (CC BY 4.0)`, 'Citation'); }
    else if (l) copy(`${location.origin}/dashboard/#${l.dataset.link}`, 'Link');
    else if (cc) { const el = document.getElementById(cc.dataset.copy); if (el) copy(el.textContent, cc.dataset.label || 'Text'); }
  });
}
function seg(el, onChange) {
  el.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; el.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); onChange(b.dataset.v); });
}

// ── Chart helpers ──
function niceStep(range, count) { const raw = range / count, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
function sparkSvg(pts, color, base) {
  if (!pts || pts.length < 2) return '';
  const W = 200, H = 34, vals = pts.map(p => p[1]).concat(base != null ? [base] : []);
  const lo = Math.min(...vals), hi = Math.max(...vals), r = hi - lo || 1;
  const x = i => i / (pts.length - 1) * W, y = v => H - 3 - (v - lo) / r * (H - 6);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${line}L${W},${H}L0,${H}Z" fill="${color}" opacity=".14"/>
    ${base != null ? `<line x1="0" x2="${W}" y1="${y(base).toFixed(1)}" y2="${y(base).toFixed(1)}" stroke="var(--ink-3)" stroke-dasharray="3 3" stroke-width="1" vector-effect="non-scaling-stroke"/>` : ''}
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(last[1]).toFixed(1)}" r="2.6" fill="${color}"/></svg>`;
}
function lineChart(el, { series, fmt = v => v.toFixed(0), baseline = null, baseLabel = '', zero = false, H = 280, unit = '' }) {
  const pts = series.flatMap(s => s.points).filter(p => p[1] != null);
  if (!pts.length) { el.innerHTML = '<p class="empty">No data for this selection.</p>'; return; }
  const W = 720, m = { t: 22, r: 14, b: 26, l: 46 };
  const xs = pts.map(p => T(p[0])), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ys = pts.map(p => p[1]).concat(baseline != null ? [baseline] : []);
  let lo = Math.min(...ys), hi = Math.max(...ys); if (zero) lo = Math.min(0, lo);
  const step = niceStep((hi - lo) || 1, 5); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step; if (hi === lo) hi = lo + step;
  const X = t => m.l + (t - x0) / ((x1 - x0) || 1) * (W - m.l - m.r), Y = v => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  let g = '';
  for (let v = lo; v <= hi + step / 2; v += step) g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${esc(fmt(v))}</text>`;
  const d0 = new Date(x0), months = [];
  for (let d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)); d.getTime() <= x1; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(new Date(d));
  const every = months.length > 9 ? 2 : 1;
  months.forEach((d, i) => { if (i % every) return; const x = X(d.getTime()); const lbl = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) + (d.getUTCMonth() === 0 ? ` ${d.getUTCFullYear()}` : ''); g += `<line class="grid" x1="${x}" x2="${x}" y1="${H - m.b}" y2="${H - m.b + 4}"/><text x="${x}" y="${H - 8}" text-anchor="middle">${esc(lbl)}</text>`; });
  if (T(WAR) > x0 && T(WAR) < x1) { const x = X(T(WAR)); g += `<line class="marker" x1="${x}" x2="${x}" y1="${m.t - 6}" y2="${H - m.b}"/><text class="marker-t" x="${x + 4}" y="${m.t - 9}">War begins 28 Feb</text>`; }
  if (baseline != null) { g += `<line class="base" x1="${m.l}" x2="${W - m.r}" y1="${Y(baseline)}" y2="${Y(baseline)}"/>`; if (baseLabel) g += `<text x="${W - m.r}" y="${Y(baseline) - 5}" text-anchor="end">${esc(baseLabel)}</text>`; }
  const lines = series.map(s => {
    const sp = s.points.filter(p => p[1] != null); if (!sp.length) return '';
    const d = sp.map((p, i) => `${i ? 'L' : 'M'}${X(T(p[0])).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    const l = sp[sp.length - 1];
    const area = series.length === 1 ? `<path d="${d}L${X(T(l[0])).toFixed(1)},${H - m.b}L${X(T(sp[0][0])).toFixed(1)},${H - m.b}Z" fill="${s.color}" opacity=".1"/>` : '';
    return `${area}<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/><circle cx="${X(T(l[0]))}" cy="${Y(l[1])}" r="3.5" fill="${s.color}"/>`;
  }).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s => s.name).join(', '))}">${g}${lines}<line class="hair" y1="${m.t}" y2="${H - m.b}" x1="0" x2="0" visibility="hidden"/><g class="dots"></g><rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg><div class="tip" hidden></div>`;
  const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), hair = svg.querySelector('.hair'), dots = svg.querySelector('.dots');
  const dates = [...new Set(pts.map(p => p[0]))].sort();
  const near = (s, d) => { let best = null; for (const p of s.points) { if (p[0] <= d) { if (p[1] != null) best = p; } else break; } return best; };
  svg.addEventListener('pointermove', ev => {
    const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) / r.width * W;
    if (sx < m.l || sx > W - m.r) return;
    const t = x0 + (sx - m.l) / (W - m.l - m.r) * (x1 - x0);
    let d = dates[0]; for (const x of dates) { if (Math.abs(T(x) - t) < Math.abs(T(d) - t)) d = x; }
    const x = X(T(d)); hair.setAttribute('x1', x); hair.setAttribute('x2', x); hair.setAttribute('visibility', 'visible');
    const rows = series.map(s => ({ s, p: near(s, d) })).filter(o => o.p);
    dots.innerHTML = rows.map(o => `<circle cx="${X(T(o.p[0]))}" cy="${Y(o.p[1])}" r="3.5" fill="${o.s.color}" stroke="var(--surface)" stroke-width="1.5"/>`).join('');
    tip.innerHTML = `<b>${esc(fmtDate(d))}</b>` + rows.sort((a, b) => b.p[1] - a.p[1]).map(o => `<div><span><i style="background:${o.s.color}"></i>${esc(o.s.name)}</span><span class="num">${esc(fmt(o.p[1]))}${esc(unit)}</span></div>`).join('');
    tip.hidden = false;
    const px = x / W * r.width, tw = tip.offsetWidth;
    tip.style.left = (px + 12 + tw > r.width ? Math.max(px - tw - 12, 0) : px + 12) + 'px';
    tip.style.top = '8px';
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; hair.setAttribute('visibility', 'hidden'); dots.innerHTML = ''; });
}

function start(D) {
  const reg = Object.fromEntries(D.reg.map(a => [a.id, a]));
  const statusOf = Object.fromEntries(D.status.map(s => [s.id, s]));
  const urlFor = id => reg[id]?.u || '/facilities/';
  const pill = st => st ? `<span class="pill" style="color:var(--${esc(st)})">${esc(STATUS[st] || st)}</span>` : `<span class="pill none">No alert</span>`;
  tools(D);

  // ── PortWatch series ──
  function pw(rows, k) {
    const avg = a => a.reduce((s, r) => s + r[k], 0) / (a.length || 1);
    const base = rows.filter(r => r[0] >= BASE.from && r[0] <= BASE.to);
    return { roll: rows.map((r, i) => [r[0], avg(rows.slice(Math.max(0, i - 6), i + 1))]), base: avg(base), now: avg(rows.slice(-7)), last: rows[rows.length - 1][0] };
  }
  const cps = D.cps.map(c => ({ ...c, st: statusOf[c.id]?.status }));

  // ── Key figures ──
  (function kpis() {
    const mk = id => D.market.find(b => b.id === id);
    const fuelE = id => D.fuel.find(f => f.id === id);
    const mTile = b => {
      if (!b) return '';
      const c = pct(b.v, b.pre), hi = Math.max(b.peak?.v ?? b.v, b.v), lo = Math.min(b.pre, b.v), span = hi - lo || 1;
      const P = v => ((v - lo) / span * 100).toFixed(1);
      return `<a class="kpi" href="#prices"><div class="kpi-l">${esc(b.label)} <small>${esc(fmtDate(b.src?.d || D.market_as_of, { day: 'numeric', month: 'short' }))}</small></div>
        <div class="kpi-v">${n(b.v, 2)}<small>${esc(b.unit)}</small></div>
        <div class="kpi-d"><span class="${cls(c)}">${signed(c)}</span> since 23 Feb</div>
        <div class="range"><div class="track"></div><div class="fill" style="left:${P(b.pre)}%;width:${(P(hi) - P(b.pre)).toFixed(1)}%"></div><div class="now" style="left:${P(b.v)}%"></div></div>
        <div class="range-l"><span>Pre-crisis ${n(b.pre, 2)}</span><span>${b.peak?.v != null ? `Peak ${n(b.peak.v, 2)}` : ''}</span></div></a>`;
    };
    const fTile = (id, fuel, label) => {
      const e = fuelE(id), f = e?.[fuel]; if (!f) return '';
      const c = pct(f.now, f.pre);
      return `<a class="kpi" href="#prices"><div class="kpi-l">${esc(label)} <small>${esc(fmtDate(f.date, { day: 'numeric', month: 'short' }))}</small></div>
        <div class="kpi-v">${n(f.now, 2)}<small>${esc(e.unit)}</small></div>
        <div class="kpi-d"><span class="${cls(c)}">${signed(c)}</span> since 23 Feb · ${signed(pct(f.now, f.wk), 1)} on the week</div>
        ${sparkSvg(f.h, 'var(--oil)', f.pre)}</a>`;
    };
    const h = cps.find(c => c.id === 'strait-of-hormuz');
    let hTile = '';
    if (h?.pw?.length) {
      const hs = pw(h.pw, 1), hc = pct(hs.now, hs.base);
      hTile = `<a class="kpi" href="#chokepoints"><div class="kpi-l">Hormuz tankers per day <small>7-day avg to ${esc(fmtDate(hs.last, { day: 'numeric', month: 'short' }))}</small></div>
        <div class="kpi-v">${n(hs.now, 1)}<small>vs ${n(hs.base, 0)} before</small></div>
        <div class="kpi-d"><span class="${hc < -10 ? 'up' : ''}">${signed(hc)}</span> against the Sep–Feb average</div>${sparkSvg(hs.roll.filter(p => p[0] >= '2025-12-01'), 'var(--accent)', hs.base)}</a>`;
    }
    const counts = {}; D.status.forEach(s => counts[s.status] = (counts[s.status] || 0) + 1);
    const order = ['closed', 'damaged', 'disrupted', 'reduced', 'offline'].filter(s => counts[s]);
    const crit = D.events.filter(e => e.sev === 'critical').length;
    const last30 = D.events.filter(e => T(e.date) > T(D.updated) - 30 * 864e5).length;
    $('#kpis').innerHTML = [
      mTile(mk('brent')), mTile(mk('ttf')), mTile(mk('jkm')), hTile,
      fTile('us', 'diesel', 'US diesel, national average'), fTile('eu', 'diesel', 'EU diesel, weighted average'),
      `<a class="kpi" href="#infrastructure"><div class="kpi-l">Assets with a live disruption <small>${esc(fmtDate(D.updated, { day: 'numeric', month: 'short' }))}</small></div>
        <div class="kpi-v">${D.status.length}<small>of ${D.reg.length} mapped</small></div>
        <div class="stack">${order.map(s => `<i style="flex:${counts[s]};background:var(--${s})"></i>`).join('')}</div>
        <div class="legend">${order.map(s => `<span><i style="background:var(--${s})"></i>${counts[s]} ${esc(STATUS[s].toLowerCase())}</span>`).join('')}</div></a>`,
      `<a class="kpi" href="#events"><div class="kpi-l">Sourced events logged <small>since 28 Feb</small></div>
        <div class="kpi-v">${D.events.length}<small>${last30} in the last 30 days</small></div>
        <div class="kpi-d"><span class="up">${crit} critical</span> · ${D.events.filter(e => e.conf === 'confirmed').length} confirmed, ${D.events.filter(e => e.conf === 'reported').length} reported</div></a>`,
    ].join('');
  })();

  // ── Chokepoints ──
  let cpSel = cps.find(c => c.id === 'strait-of-hormuz' && c.pw) ? 'strait-of-hormuz' : cps.find(c => c.pw)?.id, cpK = 1;
  function chokepoints() {
    const rows = cps.slice().sort((a, b) => (b.oil || 0) - (a.oil || 0));
    const maxOil = Math.max(...rows.map(c => c.oil || 0), 1);
    $('#cpTable tbody').innerHTML = rows.map(c => {
      const s = c.pw ? pw(c.pw, cpK) : null, ch = s ? pct(s.now, s.base) : null;
      return `<tr class="${c.pw ? 'click' : ''} ${c.id === cpSel ? 'sel' : ''}" data-id="${esc(c.id)}" ${c.pw ? 'tabindex="0"' : ''}>
        <td><a href="${esc(urlFor(c.id))}" style="color:inherit;font-weight:600;text-decoration:none">${esc(c.name)}</a><span class="sub">${pill(c.st)}</span></td>
        <td class="n">${c.oil != null ? `${n(c.oil, 1)} <small style="color:var(--ink-3)">mb/d</small><div style="height:3px;background:var(--surface-2);border-radius:2px;margin-top:3px"><div style="height:3px;width:${(c.oil / maxOil * 100).toFixed(0)}%;background:var(--oil);border-radius:2px;margin-left:auto"></div></div>` : '—'}</td>
        <td class="n">${s ? n(s.now, 1) : '—'}<span class="sub">${s ? `base ${n(s.base, 0)}` : 'no feed'}</span></td>
        <td class="n"><span class="${ch != null && ch < -10 ? 'up' : ch != null && ch > 10 ? 'down' : ''}">${signed(ch)}</span></td>
        <td style="width:110px">${s ? sparkSvg(s.roll.filter(p => p[0] >= '2025-12-01'), ch < -10 ? 'var(--crit)' : 'var(--accent)', s.base) : ''}</td></tr>`;
    }).join('');
    const c = cps.find(x => x.id === cpSel);
    if (!c?.pw) { $('#cpChart').innerHTML = '<p class="empty">Ship-tracking data is unavailable right now.</p>'; return; }
    const s = pw(c.pw, cpK), ch = pct(s.now, s.base), what = cpK === 1 ? 'tankers' : 'vessels';
    $('#cpTitle').textContent = `${c.name}: ${what} per day`;
    $('#cpCallout').innerHTML = `<span><b>${n(s.now, 1)}</b> per day, last 7 days</span><span><b>${n(s.base, 1)}</b> Sep–Feb average</span><span><b class="${ch < -10 ? 'up' : ''}">${signed(ch)}</b> change</span>${c.oil ? `<span><b>${n(c.oil, 1)} mb/d</b> normal oil flow</span>` : ''}`;
    lineChart($('#cpChart'), { series: [{ name: `${c.name}, 7-day avg`, color: 'var(--accent)', points: s.roll }], baseline: s.base, baseLabel: 'Sep–Feb average', zero: true });
  }
  $('#cpTable').addEventListener('click', e => { if (e.target.closest('a')) return; const tr = e.target.closest('tr.click'); if (tr) { cpSel = tr.dataset.id; chokepoints(); } });
  $('#cpTable').addEventListener('keydown', e => { const tr = e.target.closest('tr.click'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); cpSel = tr.dataset.id; chokepoints(); } });
  seg($('#cpMetric'), v => { cpK = +v; chokepoints(); });

  // ── Prices ──
  const PRESETS = {
    economies: { ids: ['us', 'eu', 'de', 'uk', 'fr', 'it'], help: 'Showing the five largest economies we cover (US, Germany, UK, France, Italy) and the EU average.' },
    rises: { help: f => `Showing the six areas where ${f} has risen most since 23 Feb.` },
    falls: { help: f => `Showing the six areas where ${f} has risen least since 23 Feb.` },
    usregions: { ids: ['us-east', 'us-midwest', 'us-gulf', 'us-rockies', 'us-west', 'us-california'], help: 'Showing the six regional averages the US EIA publishes.' },
  };
  const ASIA = ['China', 'India', 'Japan', 'South Korea', 'Indonesia', 'Malaysia', 'Philippines', 'Thailand', 'Vietnam', 'Pakistan', 'Bangladesh', 'Sri Lanka'];
  const fuelById = Object.fromEntries(D.fuel.map(e => [e.id, e]));
  const P = { fuel: 'diesel', measure: 'pct', preset: 'economies', sel: PRESETS.economies.ids.filter(id => fuelById[id]), group: 'country', q: '', sort: { k: 'chg', dir: 'desc' } };
  const toUsd = (e, v) => v == null ? null : e.unit === '$/gal' ? v / 3.78541 : e.cur === 'EUR' ? v * D.fx.eur : e.cur === 'GBP' ? v * D.fx.gbp : v;
  const colorOf = id => PAL[P.sel.indexOf(id) % PAL.length];
  function applyPreset(k) {
    P.preset = k;
    if (PRESETS[k].ids) P.sel = PRESETS[k].ids.filter(id => fuelById[id]);
    else {
      const ranked = D.fuel.filter(e => e[P.fuel] && e.group !== 'us-region').map(e => [e.id, pct(e[P.fuel].now, e[P.fuel].pre)]).sort((a, b) => b[1] - a[1]);
      P.sel = (k === 'rises' ? ranked.slice(0, 6) : ranked.slice(-6).reverse()).map(r => r[0]);
    }
    $('#presetSeg').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === k));
  }
  function prices() {
    const f = P.fuel, ph = P.preset ? PRESETS[P.preset].help : null;
    $('#pickHelp').innerHTML = `${esc(ph ? (typeof ph === 'function' ? ph(f) : ph) : 'Your own selection.')} <b>To change the lines,</b> tick rows in the table, use <b>Add to chart</b>, or remove a name below. Up to six at once.`;
    $('#selChips').innerHTML = P.sel.map(id => `<button class="chip" type="button" data-id="${esc(id)}" aria-label="Remove ${esc(fuelById[id].name)} from the chart"><span class="dot" style="background:${colorOf(id)}"></span>${esc(fuelById[id].name)}<span class="x" aria-hidden="true">×</span></button>`).join('') || '<span class="kpi-d">Nothing charted.</span>';
    const opts = D.fuel.filter(e => e[f] && !P.sel.includes(e.id)).sort((a, b) => a.name.localeCompare(b.name));
    $('#addSel').innerHTML = `<option value="">+ Add to chart…</option><optgroup label="Countries and EU">${opts.filter(e => e.group !== 'us-region').map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</optgroup><optgroup label="US regions">${opts.filter(e => e.group === 'us-region').map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</optgroup><optgroup label="Asia (not covered yet)">${ASIA.map(a => `<option disabled>${esc(a)}</option>`).join('')}</optgroup>`;
    let measure = P.measure, note = '';
    const units = new Set(P.sel.map(id => fuelById[id].unit));
    if (measure === 'local' && units.size > 1) { measure = 'usd'; note = 'These areas use different currencies, so the chart shows US$ per litre. Pick areas with one currency to see local prices. '; }
    const series = P.sel.map(id => {
      const e = fuelById[id], s = e[f]; if (!s) return null;
      const val = v => measure === 'pct' ? pct(v, s.pre) : measure === 'usd' ? toUsd(e, v) : v;
      return { name: e.name, color: colorOf(id), points: s.h.map(p => [p[0], val(p[1])]) };
    }).filter(Boolean);
    const unit = measure === 'pct' ? '%' : measure === 'usd' ? ' $/l' : ` ${[...units][0] || ''}`;
    lineChart($('#priceChart'), { series, fmt: measure === 'pct' ? v => (v > 0 ? '+' : '') + v.toFixed(0) : v => v.toFixed(2), unit, baseline: measure === 'pct' ? 0 : null, baseLabel: measure === 'pct' ? '23 Feb level' : '', H: 300 });
    $('#priceNote').textContent = note + (measure === 'pct' ? `Change in the weekly ${f} price against each area's price in the week of 23 Feb 2026.` : measure === 'usd' ? `Weekly ${f} price in US dollars per litre at ${fmtDate(D.fx.date)} exchange rates.` : `Weekly ${f} price in ${[...units][0]}.`);
    const asia = P.group === 'asia';
    $('#priceWrap').hidden = asia; $('#asiaGap').hidden = !asia; $('#priceSearch').hidden = asia;
    if (asia) return;
    const q = P.q.toLowerCase();
    const rows = D.fuel.filter(e => e[f] && (q ? e.name.toLowerCase().includes(q) : (P.group === 'country' ? e.group !== 'us-region' : e.group === 'us-region' || e.id === 'us')))
      .map(e => ({ e, name: e.name, now: e[f].now, usd: toUsd(e, e[f].now), chg: pct(e[f].now, e[f].pre) }));
    const { k, dir } = P.sort; rows.sort((a, b) => (k === 'name' ? a.name.localeCompare(b.name) : (a[k] ?? -1e9) - (b[k] ?? -1e9)) * (dir === 'asc' ? 1 : -1));
    const maxC = Math.max(...rows.map(r => Math.abs(r.chg || 0)), 1);
    $('#priceTable tbody').innerHTML = rows.map(r => {
      const on = P.sel.includes(r.e.id), w = Math.abs(r.chg || 0) / maxC * 72;
      return `<tr class="click ${on ? 'sel' : ''}" data-id="${esc(r.e.id)}">
        <td class="cb"><input type="checkbox" ${on ? 'checked' : ''} aria-label="Chart ${esc(r.name)}" style="accent-color:${on ? colorOf(r.e.id) : 'var(--accent)'}"></td>
        <td><a href="/fuel-prices/${esc(r.e.id)}/" style="color:inherit;text-decoration:none">${esc(r.name)}</a>${r.e.group === 'eu-average' ? ' <span class="tag">weighted</span>' : ''}</td>
        <td class="n">${n(r.now, 3)}<span class="sub">${esc(r.e.unit)}</span></td>
        <td class="n">${n(r.usd, 2)}</td>
        <td><div class="bar"><i style="left:0;width:${w.toFixed(1)}%;background:${r.chg >= 0 ? 'var(--crit)' : 'var(--ok)'};opacity:.8"></i><b style="left:calc(${w.toFixed(1)}% + 6px)" class="${cls(r.chg)}">${signed(r.chg)}</b></div></td></tr>`;
    }).join('') || `<tr><td colspan="5" class="empty">No area matches “${esc(P.q)}”.</td></tr>`;
    document.querySelectorAll('#priceTable th button').forEach(b => b.dataset.k === k ? b.dataset.dir = dir : delete b.dataset.dir);
  }
  function togglePrice(id) {
    const i = P.sel.indexOf(id);
    if (i >= 0) P.sel.splice(i, 1); else { if (P.sel.length >= 6) { const out = P.sel.shift(); toast(`Up to six lines at once. Removed ${fuelById[out].name}.`); } P.sel.push(id); }
    P.preset = null; $('#presetSeg').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false'));
    prices();
  }
  $('#priceTable tbody').addEventListener('click', e => { if (e.target.closest('a')) return; const tr = e.target.closest('tr.click'); if (tr) togglePrice(tr.dataset.id); });
  $('#selChips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) togglePrice(b.dataset.id); });
  $('#addSel').addEventListener('change', e => { if (e.target.value) togglePrice(e.target.value); });
  $('#priceTable thead').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const k = b.dataset.k; P.sort = { k, dir: P.sort.k === k ? (P.sort.dir === 'asc' ? 'desc' : 'asc') : (k === 'name' ? 'asc' : 'desc') }; prices(); });
  seg($('#presetSeg'), v => { applyPreset(v); prices(); });
  seg($('#fuelSeg'), v => { P.fuel = v; if (P.preset === 'rises' || P.preset === 'falls') applyPreset(P.preset); prices(); });
  seg($('#measureSeg'), v => { P.measure = v; prices(); });
  seg($('#groupSeg'), v => { P.group = v; prices(); });
  $('#priceSearch').addEventListener('input', e => { P.q = e.target.value.trim(); prices(); });

  // ── Infrastructure ──
  const stOn = new Set(Object.keys(STATUS));
  let regQ = '', regT = '', regAll = false;
  function infrastructure() {
    const counts = {}; D.status.forEach(s => counts[s.status] = (counts[s.status] || 0) + 1);
    const order = ['closed', 'damaged', 'disrupted', 'reduced', 'offline'].filter(s => counts[s]);
    $('#statusBar').innerHTML = order.map(s => `<button type="button" data-s="${s}" aria-pressed="${stOn.has(s)}" style="flex:${counts[s]};background:var(--${s})" aria-label="${esc(STATUS[s])}: ${counts[s]}. Show or hide">${counts[s]}</button>`).join('');
    $('#statusLegend').innerHTML = order.map(s => `<span><i style="background:var(--${s})"></i>${esc(STATUS[s])} ${counts[s]}</span>`).join('') + '<span style="color:var(--ink-3)">Select a segment to filter.</span>';
    const rank = { closed: 0, damaged: 1, offline: 2, disrupted: 3, reduced: 4 };
    $('#assetCards').innerHTML = D.status.filter(s => stOn.has(s.status)).sort((a, b) => rank[a.status] - rank[b.status] || ((a.since || '') < (b.since || '') ? -1 : 1)).map(s => {
      const a = reg[s.id] || { name: s.id, type: '' };
      return `<article class="asset" style="--c:var(--${esc(s.status)})"><h4><a href="${esc(urlFor(s.id))}">${esc(a.name)}</a></h4>
        <div class="meta">${pill(s.status)}<span class="tag">${esc(TYPE[a.type] || a.type)}</span>${s.since ? `<span>since ${esc(fmtDate(s.since))}</span>` : ''}${s.conf ? `<span>· ${esc(s.conf)}</span>` : ''}</div>
        <p>${esc(s.summary)}</p>
        <div class="srcs">${s.nsrc} source${s.nsrc === 1 ? '' : 's'}: ${s.src.slice(0, 2).map(x => `<a href="${esc(safeUrl(x.u))}" target="_blank" rel="noopener">${esc(String(x.n).split(' — ')[0])}</a>`).join(', ')}${s.nsrc > 2 ? ` +${s.nsrc - 2} more` : ''} · updated ${esc(fmtDate(s.updated || D.updated))}</div></article>`;
    }).join('') || '<p class="empty">No assets in the selected statuses.</p>';
    const q = regQ.toLowerCase();
    const rows = D.reg.filter(a => (!regT || a.type === regT) && (!q || (a.name + ' ' + a.d + ' ' + a.sub).toLowerCase().includes(q)))
      .sort((a, b) => (statusOf[a.id] ? 0 : 1) - (statusOf[b.id] ? 0 : 1) || a.name.localeCompare(b.name));
    const shown = regAll ? rows : rows.slice(0, 12);
    $('#regTable tbody').innerHTML = shown.map(a => `<tr><td><a href="${esc(urlFor(a.id))}">${esc(a.name)}</a></td><td><span class="tag">${esc(TYPE[a.type])}</span>${a.sub ? ` <span class="sub" style="display:inline">${esc(a.sub)}</span>` : ''}</td><td>${pill(statusOf[a.id]?.status)}</td><td style="min-width:260px;color:var(--ink-2);font-size:12.5px">${esc(a.d || (a.vol ? `${a.vol} mb/d` : ''))}</td></tr>`).join('') || `<tr><td colspan="4" class="empty">No assets match.</td></tr>`;
    const btn = $('#regMore'); btn.hidden = rows.length <= 12; btn.textContent = regAll ? 'Show fewer' : `Show all ${rows.length} assets`;
  }
  $('#statusBar').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const s = b.dataset.s, all = Object.keys(STATUS).length; if (stOn.has(s) && stOn.size === 1) Object.keys(STATUS).forEach(x => stOn.add(x)); else if (stOn.size === all) { stOn.clear(); stOn.add(s); } else stOn.has(s) ? stOn.delete(s) : stOn.add(s); infrastructure(); });
  $('#regSearch').addEventListener('input', e => { regQ = e.target.value.trim(); infrastructure(); });
  $('#regType').addEventListener('change', e => { regT = e.target.value; infrastructure(); });
  $('#regMore').addEventListener('click', () => { regAll = !regAll; infrastructure(); });

  // ── Events ──
  const CATS = [...new Set(D.events.map(e => e.cat))].sort();
  const E = { cats: new Set(), q: '', week: null, all: false };
  const weekOf = d => { const t = new Date(T(d)); t.setUTCDate(t.getUTCDate() - (t.getUTCDay() + 6) % 7); return t.toISOString().slice(0, 10); };
  const evFiltered = ignoreWeek => { const q = E.q.toLowerCase(); return D.events.filter(e => (!E.cats.size || E.cats.has(e.cat)) && (!q || (e.t + ' ' + e.s).toLowerCase().includes(q)) && (ignoreWeek || !E.week || weekOf(e.date) === E.week)); };
  function evChart() {
    const list = evFiltered(true), weeks = [];
    for (let t = T(weekOf(WAR)); t <= T(D.updated); t += 7 * 864e5) weeks.push(new Date(t).toISOString().slice(0, 10));
    const by = Object.fromEntries(weeks.map(w => [w, { critical: 0, high: 0, medium: 0, low: 0 }]));
    list.forEach(e => { const w = weekOf(e.date); if (by[w] && by[w][e.sev] != null) by[w][e.sev]++; });
    const max = Math.max(1, ...weeks.map(w => SEV.reduce((s, k) => s + by[w][k], 0)));
    const W = 720, H = 150, m = { t: 10, r: 6, b: 22, l: 26 }, bw = (W - m.l - m.r) / weeks.length;
    const step = max <= 5 ? 1 : max <= 10 ? 2 : 5, top = Math.ceil(max / step) * step, Y = v => m.t + (1 - v / top) * (H - m.t - m.b);
    let g = '';
    for (let v = 0; v <= top; v += step) g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
    weeks.forEach((w, i) => {
      let acc = 0; const x = m.l + i * bw + 1.5, tot = SEV.reduce((s, k) => s + by[w][k], 0);
      const dim = E.week && E.week !== w ? ' opacity=".3"' : '';
      SEV.slice().reverse().forEach(k => { const v = by[w][k]; if (!v) return; g += `<rect x="${x}" width="${Math.max(bw - 3, 1)}" y="${Y(acc + v)}" height="${Y(acc) - Y(acc + v)}" fill="${SEVC[k]}"${dim}/>`; acc += v; });
      g += `<rect x="${m.l + i * bw}" width="${bw}" y="${m.t}" height="${H - m.t - m.b}" fill="transparent" data-w="${w}" style="cursor:pointer"><title>Week of ${esc(fmtDate(w))}: ${tot} event${tot === 1 ? '' : 's'}</title></rect>`;
      const d = new Date(T(w)); if (d.getUTCDate() <= 7) g += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }))}</text>`;
    });
    $('#evChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Events per week by severity">${g}</svg>`;
    $('#evLegend').innerHTML = SEV.map(k => `<span><i style="background:${SEVC[k]}"></i>${k[0].toUpperCase() + k.slice(1)}</span>`).join('');
  }
  function events() {
    $('#catChips').innerHTML = CATS.map(c => `<button class="chip" type="button" data-c="${esc(c)}" aria-pressed="${E.cats.has(c)}">${esc(c[0].toUpperCase() + c.slice(1))} <span style="opacity:.7">${D.events.filter(e => e.cat === c).length}</span></button>`).join('');
    evChart();
    const list = evFiltered(false), shown = E.all ? list : list.slice(0, 8);
    $('#evCount').textContent = `${list.length} of ${D.events.length} events`;
    $('#evActive').innerHTML = E.week ? `<button class="chip" type="button" aria-pressed="true" id="clearWeek">Week of ${esc(fmtDate(E.week, { day: 'numeric', month: 'short' }))} <span class="x" aria-hidden="true">×</span></button>` : '';
    $('#evList').innerHTML = shown.map(e => `<article class="ev" style="--c:${SEVC[e.sev] || 'var(--low)'}"><time datetime="${esc(e.date)}">${esc(fmtDate(e.date))}</time><div>
      <h4>${esc(e.t)}</h4><p>${esc(e.s)}</p>
      <div class="meta"><span class="tag">${esc(e.sev)}</span><span class="tag">${esc(e.cat)}</span><span class="tag">${esc(e.conf)}</span>${e.assets.slice(0, 3).map(id => reg[id] ? `<a href="${esc(urlFor(id))}">${esc(reg[id].name)}</a>` : '').join(' ')}
      ${e.src ? `<span>· <a href="${esc(safeUrl(e.src.u))}" target="_blank" rel="noopener">${esc(String(e.src.n).split(' — ')[0])}</a>${e.nsrc > 1 ? ` +${e.nsrc - 1}` : ''}</span>` : ''}</div></div></article>`).join('') || '<p class="empty">No events match these filters.</p>';
    const b = $('#evMore'); b.hidden = list.length <= 8; b.textContent = E.all ? 'Show fewer' : `Show all ${list.length} events`;
  }
  $('#catChips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; const c = b.dataset.c; E.cats.has(c) ? E.cats.delete(c) : E.cats.add(c); events(); });
  $('#evChart').addEventListener('click', e => { const r = e.target.closest('[data-w]'); if (!r) return; E.week = E.week === r.dataset.w ? null : r.dataset.w; events(); });
  $('#evActive').addEventListener('click', e => { if (e.target.closest('#clearWeek')) { E.week = null; events(); } });
  $('#evSearch').addEventListener('input', e => { E.q = e.target.value.trim(); events(); });
  $('#evMore').addEventListener('click', () => { E.all = !E.all; events(); });

  // ── Exposure ──
  (function exposure() {
    const rows = cps.filter(c => c.oil != null).sort((a, b) => b.oil - a.oil), max = Math.max(...rows.map(c => c.oil), 1);
    $('#expo').innerHTML = rows.map(c => `<div class="expo-row"><div><a href="${esc(urlFor(c.id))}" style="color:inherit;font-weight:600;text-decoration:none">${esc(c.name)}</a> ${pill(c.st)}</div>
      <div class="track" role="img" aria-label="${esc(c.name)}: ${n(c.oil, 1)} million barrels a day${c.bypass ? `, ${n(c.bypass, 1)} of bypass capacity` : ''}"><div class="flow" style="width:${(c.oil / max * 100).toFixed(1)}%"></div>${c.bypass ? `<div class="byp" style="width:${(c.bypass / max * 100).toFixed(1)}%"></div>` : ''}</div>
      <div class="r"><b style="color:var(--ink)">${n(c.oil, 1)}</b> mb/d<br>${n(c.oil / D.world_demand * 100, 0)}% of world demand${c.bypass ? `<br>${n(c.bypass, 1)} bypass` : ''}</div></div>`).join('');
  })();

  // ── Section index highlight ──
  const links = [...document.querySelectorAll('.index a[href^="#"]')];
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id)); }), { rootMargin: '-40% 0px -55% 0px' });
    document.querySelectorAll('.dash-main > section').forEach(s => io.observe(s));
  }

  chokepoints(); prices(); infrastructure(); events();
  document.querySelectorAll('.loading').forEach(el => el.remove());
}

fetch($('#dash')?.dataset.src || '/data/v1/dashboard.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(start).catch(err => {
  console.error('Dashboard data failed to load', err);
  document.querySelectorAll('.loading').forEach(el => { el.textContent = 'The interactive charts could not load. The key figures, benchmarks and downloads on this page still work.'; });
});
})();
