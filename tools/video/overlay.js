/* Injected into the page before any script runs (record.mjs → addInitScript).
 * Exposes the Leaflet map as window.__map and window.__vd: a virtual clock for frame-by-frame rendering,
 * plus captions, cursor, highlights and title cards.
 */
(() => {
  // Same-origin iframes (an embedded map) get the clock and Leaflet hooks too, driven by the top page's tick();
  // only the top page gets the overlay.
  const TOP = window.top === window;
  const children = () => [...document.querySelectorAll('iframe')].map(f => { try { return f.contentWindow.__vd; } catch { return null; } }).filter(Boolean);

  // ── Virtual clock ──
  // Until virtualize() is called everything runs in real time. After it, time only moves when record.mjs calls
  // tick(ms) before each screenshot: timers, requestAnimationFrame, Date, performance.now and every CSS
  // animation/transition advance by exactly one frame, so motion is perfectly even however slow a frame renders.
  // Installed here, before Leaflet loads, because Leaflet keeps its own reference to requestAnimationFrame.
  const RealDate = Date, realNow = Date.now.bind(Date), realPerf = performance.now.bind(performance);
  const realRaf = window.requestAnimationFrame.bind(window), realCaf = window.cancelAnimationFrame.bind(window);
  const realSetTimeout = window.setTimeout.bind(window), realClearTimeout = window.clearTimeout.bind(window);
  const realSetInterval = window.setInterval.bind(window), realClearInterval = window.clearInterval.bind(window);
  const VID = 1e9; // virtual timer/frame ids start here so clear*() knows which kind it got
  let virtual = false, vt = 0, vt0 = 0, perf0 = 0, nextId = VID;
  const timers = new Map(), seen = new WeakMap();
  let rafQ = new Map();

  function VDate(...a) {
    if (!new.target) return new RealDate(virtual ? vt : realNow()).toString();
    return a.length ? new RealDate(...a) : new RealDate(virtual ? vt : realNow());
  }
  VDate.prototype = RealDate.prototype;
  VDate.now = () => virtual ? vt : realNow();
  VDate.UTC = RealDate.UTC; VDate.parse = RealDate.parse;
  window.Date = VDate;
  performance.now = () => virtual ? perf0 + (vt - vt0) : realPerf();

  window.requestAnimationFrame = cb => { if (!virtual) return realRaf(cb); const id = nextId++; rafQ.set(id, cb); return id; };
  window.cancelAnimationFrame = id => id >= VID ? rafQ.delete(id) : realCaf(id);
  const addTimer = (fn, ms, args, repeat) => {
    const id = nextId++;
    timers.set(id, { id, fn: typeof fn === 'function' ? fn : () => {}, due: vt + Math.max(0, +ms || 0), every: repeat ? Math.max(1, +ms || 0) : null, args });
    return id;
  };
  window.setTimeout = (fn, ms, ...args) => virtual ? addTimer(fn, ms, args, false) : realSetTimeout(fn, ms, ...args);
  window.setInterval = (fn, ms, ...args) => virtual ? addTimer(fn, ms, args, true) : realSetInterval(fn, ms, ...args);
  window.clearTimeout = id => id >= VID ? timers.delete(id) : realClearTimeout(id);
  window.clearInterval = id => id >= VID ? timers.delete(id) : realClearInterval(id);

  function stepAnimations(dt) {
    for (const a of document.getAnimations()) {
      let t = seen.get(a);
      if (t === undefined) { a.pause(); t = 0; } // started since the last frame
      t += dt;
      const end = a.effect?.getComputedTiming().endTime;
      if (Number.isFinite(end) && t >= end) { a.finish(); seen.delete(a); continue; }
      a.currentTime = t; seen.set(a, t);
    }
  }

  // ── Leaflet hooks ──
  // app.js keeps `map` in a closure; catch it as Leaflet creates it. While recording, vector layers are also
  // redrawn on every frame of a fly, instead of being stretched and then snapping sharp when the move ends.
  let realL;
  Object.defineProperty(window, 'L', {
    configurable: true,
    get: () => realL,
    set(v) {
      realL = v;
      try {
        v.Map.addInitHook(function () {
          window.__map = this;
          // Track camera moves from any source (our scripted flights and the app's own, e.g. clicking a chokepoint)
          this.on('movestart', () => { moving = true; });
          this.on('moveend', () => { moving = false; });
          // The app flies in 0.8 s, too fast to follow on video: stretch its flights while recording
          const flyTo = this.flyTo;
          this.flyTo = function (ll, z, o = {}) {
            if (virtual && window.__vd.minFly) o = { ...o, duration: Math.max(o.duration ?? 0, window.__vd.minFly), easeLinearity: o.easeLinearity ?? 0.2 };
            return flyTo.call(this, ll, z, o);
          };
          this.on('move', () => {
            if (!virtual || !this._loaded) return;
            this.eachLayer(l => { if (l instanceof v.Renderer && l._map) l._reset(); });
          });
        });
      } catch (e) {}
    },
  });
  let moving = false;
  const tilesLoading = () => {
    let n = false;
    window.__map?.eachLayer(l => { if (l.isLoading?.()) n = true; });
    return n || children().some(c => c.tilesLoading());
  };

  // ── Overlay ──
  const CSS = `
  #vd-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
  #vd-cap { position: absolute; left: 50%; bottom: 74px; transform: translate(-50%, 12px); max-width: 760px; width: max-content;
    background: rgba(20, 28, 40, 0.93); color: #fff; font-size: 21px; line-height: 1.38; font-weight: 500; letter-spacing: -0.005em;
    padding: 14px 22px 15px; border-radius: 12px; border-left: 5px solid #e67e22; box-shadow: 0 10px 34px rgba(0,0,0,0.28);
    opacity: 0; transition: opacity .45s ease, transform .45s ease; text-wrap: balance; }
  #vd-cap.on { opacity: 1; transform: translate(-50%, 0); }
  #vd-cap b { color: #ffc28a; font-weight: 700; }
  #vd-cap code, #vd-code code { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: .9em; color: #ffc28a;
    background: rgba(255,255,255,.1); padding: 1px 6px; border-radius: 5px; }
  #vd-code { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -46%); width: min(980px, 88vw); opacity: 0;
    transition: opacity .5s ease, transform .5s ease; background: #141c28; color: #e6edf5; border-radius: 14px; padding: 22px 28px 26px;
    box-shadow: 0 24px 70px rgba(0,0,0,.4); font-family: 'Segoe UI', system-ui, sans-serif; }
  #vd-code.on { opacity: 1; transform: translate(-50%, -50%); }
  #vd-code .vd-lbl { font-size: 13px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #e67e22; margin-bottom: 12px; }
  #vd-code pre { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 19px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; }
  #vd-code .vd-t { color: #7fb4e8; } #vd-code .vd-a { color: #ffc28a; } #vd-code .vd-s { color: #9fe0b0; }
  #vd-cursor { position: absolute; left: 0; top: 0; width: 26px; height: 26px; transform: translate(720px, 520px);
    transition: transform .85s cubic-bezier(.45, .05, .25, 1); filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
  #vd-ripple { position: absolute; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; border: 3px solid #e67e22; opacity: 0; }
  #vd-ripple.go { animation: vd-rip .6s ease-out; }
  @keyframes vd-rip { from { transform: scale(.3); opacity: .9; } to { transform: scale(1.4); opacity: 0; } }
  .vd-ring { position: absolute; border: 3px solid #e67e22; border-radius: 10px; box-shadow: 0 0 0 5px rgba(230,126,34,.22);
    animation: vd-ring 1.25s ease-in-out infinite; transition: opacity .4s; }
  @keyframes vd-ring { 50% { box-shadow: 0 0 0 11px rgba(230,126,34,0); } }
  #vd-card { position: absolute; inset: 0; background: #f5f5f0; display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; color: #1a2332; opacity: 1; transition: opacity .7s ease; padding: 0 120px; }
  #vd-card.off { opacity: 0; }
  #vd-card .vd-kick { font-size: 15px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #c75000; margin-bottom: 18px;
    display: flex; align-items: center; gap: 10px; }
  #vd-card .vd-kick img { width: 26px; height: 26px; }
  #vd-card h1 { font-size: 54px; line-height: 1.1; font-weight: 750; letter-spacing: -0.02em; max-width: 1000px; text-wrap: balance; }
  #vd-card p { font-size: 22px; color: #4a5568; margin-top: 20px; max-width: 820px; line-height: 1.45; text-wrap: balance; }
  #vd-card .vd-url { margin-top: 30px; font-size: 26px; font-weight: 700; color: #1a6bb5; }
  #vd-card .vd-rule { width: 72px; height: 4px; background: #e67e22; border-radius: 2px; margin: 26px auto 0; }
  #vd-card .vd-follow { margin-top: 14px; font-size: 16px; color: #8a94a6; }
  `;

  const CURSOR = `<svg viewBox="0 0 26 26" width="26" height="26"><path d="M4 2.5l0 19 5.2-4.9 3.6 7.9 3.3-1.5-3.6-7.8 7.1-.4z" fill="#fff" stroke="#1a2332" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

  function mount() {
    if (document.getElementById('vd-root')) return;
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    const root = document.createElement('div'); root.id = 'vd-root';
    root.innerHTML = `<div id="vd-code"></div><div id="vd-cap"></div><div id="vd-ripple"></div><div id="vd-cursor">${CURSOR}</div>
      <div id="vd-card"></div>`; // starts as a blank cover so page loading never shows
    document.body.appendChild(root);
  }
  if (TOP) document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', mount) : mount();

  const $ = id => document.getElementById(id);
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  let cur = { x: 720, y: 520 };
  window.__vd = {
    minFly: 2.2, // seconds; minimum duration of any flight while recording
    virtualize() {
      vt = vt0 = realNow(); perf0 = realPerf(); virtual = true;
      for (const a of document.getAnimations()) { a.pause(); seen.set(a, a.currentTime ?? 0); } // keep running pulses in phase
      children().forEach(c => c.virtualize());
    },
    /** Advance virtual time by one frame. Returns what record.mjs needs to know before taking the screenshot. */
    tick(dt) {
      const target = vt + dt;
      for (;;) {
        let next = null;
        for (const t of timers.values()) if (t.due <= target && (!next || t.due < next.due || (t.due === next.due && t.id < next.id))) next = t;
        if (!next) break;
        vt = Math.max(vt, next.due);
        if (next.every != null) next.due += next.every; else timers.delete(next.id);
        try { next.fn(...next.args); } catch (e) { console.error(e); }
      }
      vt = target;
      const q = rafQ; rafQ = new Map();
      const ts = performance.now();
      for (const cb of q.values()) { try { cb(ts); } catch (e) { console.error(e); } }
      stepAnimations(dt);
      const kids = children().map(c => c.tick(dt));
      return { moving: moving || kids.some(k => k.moving), loading: tilesLoading() };
    },
    tilesLoading,
    /** Close any open map tooltips, here and in embedded maps. */
    closeTooltips() {
      window.__map?.eachLayer(l => l.closeTooltip?.());
      children().forEach(c => c.closeTooltips());
    },
    /** Start a camera move (flyTo / flyToBounds); tick() reports moving until it ends. */
    move(method, args) {
      moving = true;
      window.__map.once('moveend', () => { moving = false; });
      window.__map[method](...args);
    },
    caption(html) {
      const el = $('vd-cap');
      if (!html) { el.classList.remove('on'); return; }
      const swap = () => {
        // Centre over the part of the map that isn't covered by the side panels
        const vis = id => { const r = document.getElementById(id)?.getBoundingClientRect(); return r && r.width && r.right > 20 && r.left < innerWidth - 20 ? r : null; };
        const l = vis('leftPanel'), r = vis('rightPanel');
        const a = l ? l.right : 0, b = r ? r.left : innerWidth;
        el.style.left = (a + b) / 2 + 'px'; el.style.maxWidth = Math.min(780, b - a - 48) + 'px';
        el.innerHTML = html; el.classList.add('on');
      };
      if (el.classList.contains('on')) { el.classList.remove('on'); setTimeout(swap, 380); } else swap();
    },
    // Overlay class names carry a vd- prefix so a host page's own CSS (e.g. a .url class) can't restyle them.
    card(kind, title, sub, url = 'strategicenergymap.org') {
      const el = $('vd-card');
      const kick = `<div class="vd-kick"><img src="/favicon.svg" alt="">Strategic Energy Infrastructure Map</div>`;
      el.innerHTML = kind === 'end'
        ? `${kick}<h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}<div class="vd-url">${url}</div>
           <div class="vd-follow">Follow @StratEnergyMap on X · @strategicenergymap.org on Bluesky</div>`
        : `${kick}<h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}<div class="vd-rule"></div><div class="vd-url">${url}</div>`;
      el.classList.remove('off');
    },
    hideCard() { $('vd-card').classList.add('off'); },
    /** A code card in the middle of the screen (trusted HTML), or hide it with no argument. */
    code(label, html) {
      const el = $('vd-code');
      if (!html) { el.classList.remove('on'); return; }
      el.innerHTML = `<div class="vd-lbl">${label}</div><pre>${html}</pre>`;
      el.classList.add('on');
    },
    /** Blank cover in the site's background colour, for dissolving between pages. instant: no fade. */
    cover(instant) {
      const el = $('vd-card');
      el.innerHTML = '';
      if (instant) { el.style.transition = 'none'; el.classList.remove('off'); void el.offsetWidth; el.style.transition = ''; }
      else el.classList.remove('off');
    },
    cursorTo(x, y, ms = 850) {
      cur = { x, y };
      const c = $('vd-cursor');
      c.style.transitionDuration = ms + 'ms';
      c.style.transform = `translate(${x - 4}px, ${y - 2}px)`;
    },
    ripple() {
      const r = $('vd-ripple');
      r.style.left = cur.x + 'px'; r.style.top = cur.y + 'px';
      r.classList.remove('go'); void r.offsetWidth; r.classList.add('go');
    },
    highlight(selector, ms) {
      const t = document.querySelector(selector); if (!t) return;
      const b = t.getBoundingClientRect(), pad = 6;
      const ring = document.createElement('div'); ring.className = 'vd-ring';
      Object.assign(ring.style, { left: b.left - pad + 'px', top: b.top - pad + 'px', width: b.width + pad * 2 + 'px', height: b.height + pad * 2 + 'px' });
      $('vd-root').appendChild(ring);
      setTimeout(() => { ring.style.opacity = 0; setTimeout(() => ring.remove(), 450); }, ms);
    },
    /** Eased scroll of an element's scrolling panel (native smooth scroll runs on real time, so it would jump). */
    scrollTo(selector, block = 'start', ms = 800) {
      const el = document.querySelector(selector); if (!el) return;
      let box = el.parentElement;
      while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
      box ||= document.scrollingElement; // ordinary pages scroll the document
      const e = el.getBoundingClientRect();
      const c = box === document.scrollingElement ? { top: 0, height: innerHeight } : box.getBoundingClientRect();
      const off = block === 'center' ? (c.height - e.height) / 2 : 12;
      const from = box.scrollTop, to = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, from + e.top - c.top - off));
      const start = performance.now();
      const step = () => {
        const p = Math.min(1, (performance.now() - start) / ms);
        box.scrollTop = from + (to - from) * ease(p);
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
  };
})();
