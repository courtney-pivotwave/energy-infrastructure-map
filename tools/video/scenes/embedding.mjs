/* Embedding: ~1.5 min on putting the live map on another site — ?embed=1, &region=, the iframe snippet, and the
 * map working inside a (mock, placeholder-only) host page at a reserved .example domain.
 */
const ASSET = 'yanbu-terminal'; // isolated on the Red Sea coast, so its tooltip is a clean hover inside the embed

const SNIPPET = [
  '<span class="vd-t">&lt;iframe</span>',
  '  <span class="vd-a">src</span>=<span class="vd-s">"https://strategicenergymap.org/?embed=1&amp;region=mideast"</span>',
  '  <span class="vd-a">width</span>=<span class="vd-s">"100%"</span> <span class="vd-a">height</span>=<span class="vd-s">"480"</span> <span class="vd-a">style</span>=<span class="vd-s">"border:0"</span>',
  '  <span class="vd-a">title</span>=<span class="vd-s">"Strategic Energy Infrastructure Map"</span> <span class="vd-a">loading</span>=<span class="vd-s">"lazy"</span><span class="vd-t">&gt;&lt;/iframe&gt;</span>',
].join('\n');

/** Screen position of a map coordinate inside the embedded map's iframe. */
async function framePoint(v, latlng) {
  const el = await v.page.$('iframe');
  const b = await el.boundingBox();
  const p = await (await el.contentFrame()).evaluate(ll => { const p = window.__map.latLngToContainerPoint(ll); return { x: p.x, y: p.y }; }, latlng);
  return { x: b.x + p.x, y: b.y + p.y };
}

export async function setup(v) {
  await v.page.evaluate(() => window.__vd.card('title', 'Put the live map on your own site',
    'A map-only view for articles, blogs and classrooms, in one line of HTML.'));
  await v.wait(1500);
}

export async function run(v) {
  const site = v.data('infrastructure').sites.find(s => s.id === ASSET);

  await v.wait(4500);
  await v.hideCard();
  await v.say('Want the map in your own article, blog post or lesson? There’s a view made for that.');

  // ?embed=1
  await v.say('Add <code>?embed=1</code> to the address…', { hold: 0 });
  await v.wait(1500);
  await v.goto('/?embed=1&notrack=1', { keepCaption: true });
  await v.wait(1200);
  await v.highlight('.embed-badge', 5000);
  await v.say('…and you get just the map: no panels, with a small link back to the full site.');

  // &region=
  await v.say('Add <code>&amp;region=</code> to choose where it opens: <code>europe</code>…', { hold: 0 });
  await v.wait(1500);
  await v.goto('/?embed=1&region=europe&notrack=1', { keepCaption: true });
  await v.wait(1500);
  await v.say('…<code>mideast</code>, <code>asia</code> or <code>americas</code>.', { hold: 0 });
  await v.wait(1500);
  await v.goto('/?embed=1&region=mideast&notrack=1', { keepCaption: true });
  await v.wait(2200);

  // The snippet
  await v.say('Then drop it into any page with an iframe.', { hold: 0 });
  await v.page.evaluate(html => window.__vd.code('Embed code', html), SNIPPET);
  await v.wait(8000);
  await v.page.evaluate(() => window.__vd.code());
  await v.wait(500);

  // On a host page
  await v.goto('/_video/embed-demo.html');
  await v.say('It sits in your page like any other element…');
  const b = await (await v.page.$('iframe')).boundingBox();
  await v.say('…and readers can pan around it…', { hold: 0 });
  await v.drag({ x: b.x + b.width * 0.62, y: b.y + b.height * 0.55 }, { x: b.x + b.width * 0.42, y: b.y + b.height * 0.5 }, { keepCaption: true });
  await v.wait(800);
  await v.say('…and hover anything for details.', { hold: 0 });
  await v.hover(await framePoint(v, site.coords));
  await v.wait(3500);
  await v.cursorAway();
  await v.say('It stays current as the map updates every day. Free, with no ads, no cookies and no tracking across sites.', { hold: 7000 });

  // Where to get the code
  await v.say('Get the code from the About page…', { hold: 0 });
  await v.wait(1500);
  await v.goto('/about.html?notrack=1', { keepCaption: true });
  await v.scrollTo('#embed', 'start');
  await v.say('…pick where the map opens…', { hold: 0 });
  await v.click('[data-embed-region="mideast"]', { keepCaption: true });
  await v.wait(1500);
  await v.say('…and copy it in one click.', { hold: 0 });
  await v.click('#copyEmbed', { keepCaption: true });
  await v.wait(2200);
  await v.cursorAway();

  await v.card('end', 'Embed the live map on your site',
    'Copy the ready-made code, with region options, from the About page. Free and ad-free.', 7000, 'strategicenergymap.org/about.html#embed');
}
