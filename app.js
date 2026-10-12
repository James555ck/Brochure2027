/* Cottonridge 2027 brochure.
 *
 * Everything is driven by `kept`, the set of product ids in the brochure.
 * buildBook() turns that into an ordered page list (dropping pages nobody needs,
 * keeping two-page products on a left/right spread, regenerating the index and
 * page numbers) and hands it to the page-flip engine.
 *
 * window.brochure.setKept(ids) rebuilds the book; ?kept=meteor,atlas does the same from the URL.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const wrap = $('bookwrap'), zoomer = $('zoomer'), status = $('status');
  const prevBtn = $('prev'), nextBtn = $('next');

  let catalog = null;
  let base = '';              // folder of the brochure being shown, e.g. brochures/proof/
  let kept = new Set();
  let flip = null;
  let body = [];            // visible pages in order, fillers included
  let layout = [];          // body plus transparent end blanks (landscape) - what the engine shows
  let dims = { pw: 0, ph: 0, portrait: false };
  let pageW = 595, pageH = 842;

  // ---- page list --------------------------------------------------------------
  function isVisible(p) {
    const keptP = catalog.products.filter((x) => kept.has(x.id));
    switch (p.kind) {
      case 'product': return p.requires.some((id) => kept.has(id));
      case 'divider': return p.kids ? keptP.some((x) => x.kids) : keptP.some((x) => x.tier === p.tier);
      case 'extra': return keptP.some((x) => x.tier === p.tier);
      default: return true;                        // cover, story, offer, ranges, index, cord, back
    }
  }

  /** Visible pages in order, with blank fillers so that two-page products start on a
   *  left-hand (even) position and the back cover lands on an even position. */
  function arrange() {
    const out = [];
    for (const p of catalog.pages) {
      if (!isVisible(p)) continue;
      const nextPos = out.length + 1;
      if ((p.spreadStart || p.kind === 'back') && nextPos % 2 === 1) out.push({ blank: true });
      out.push(p);
    }
    return out;
  }

  // ---- page elements ----------------------------------------------------------
  const pad2 = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function pageEl(p, pos, posOfSrc) {
    const el = document.createElement('div');
    el.className = 'page';
    if (p.blank) { el.classList.add('blank'); return el; }
    const img = document.createElement('img');
    img.src = `${base}pages/${p.id}.jpg?v=${catalog.build}`;
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    el.appendChild(img);
    if (p.kind === 'index' && catalog.live) {        // photo + white card from the PDF, index drawn live on top
      el.classList.add('index');
      el.insertAdjacentHTML('beforeend', indexHTML(posOfSrc));
    }
    if (p.num) {
      const n = document.createElement('span');
      n.className = 'pnum ' + (pos % 2 === 0 ? 'left' : 'right');
      n.textContent = pos;
      el.appendChild(n);
    }
    return el;
  }

  function indexHTML(posOfSrc) {
    const row = (label, src) => `<div class="row"><span>${esc(label)}</span><span>${posOfSrc[src]}</span></div>`;
    let html = '<div class="idx"><h2>Index</h2><div class="flow">';
    html += '<section class="sec front">' + [...catalog.frontIndex, ...catalog.backIndex].map((f) => row(f.label, f.src)).join('') + '</section>';

    for (const tier of catalog.tiers) {
      const items = catalog.products.filter((x) => x.tier === tier.id && kept.has(x.id));
      if (!items.length) continue;
      const cats = [...new Set(items.map((x) => x.category))];
      html += `<section class="sec itier"><div class="tname">${esc(tier.name)}</div>`;
      for (const cat of cats) {
        html += `<div class="cat"><div class="cname">${esc(cat)}</div><div class="items">`;
        for (const x of items.filter((i) => i.category === cat)) {
          const last = x.pages[x.pages.length - 1];
          html += `<div class="item"><span>${esc(x.name)} <span class="code">(${esc(x.code)})</span></span><span>${posOfSrc[last]}</span></div>`;
        }
        html += '</div></div>';
      }
      html += '</section>';
    }
    html += '</div>';
    if (['vulcan', 'prostar', 'andromeda'].some((id) => kept.has(id)))
      html += '<div class="quote">“We’re so happy you’re launching a Workwear Hoodie, Polo and T-Shirt so we can finally offer our customers a Cottonridge workwear bundle.”</div>';
    return html + '</div>';
  }

  // ---- book -------------------------------------------------------------------
  function buildBook() {
    // remember where the reader was so a change in the picker doesn't throw them back to the cover
    const here = flip && layout[flip.getCurrentPageIndex()];
    const hereSrc = here && !here.blank ? here.src : null;

    resetGo();
    if (flip) { try { flip.destroy(); } catch (e) { /* already gone */ } flip = null; }
    zoomer.innerHTML = '';

    dims = measure();
    if (dims.pw < 50 || dims.ph < 50) { status.hidden = false; return; }   // stage not laid out yet: the resize observer retries
    body = arrange();
    const posOfSrc = {};
    body.forEach((p, i) => { if (!p.blank) posOfSrc[p.src] = i + 1; });
    // Landscape: a transparent blank either side puts the cover/back cover on a single page
    // (as the leavers flipbook does), so they turn like any other page instead of as a stiff board.
    layout = dims.portrait ? body : [{ blank: true, edge: true }, ...body, { blank: true, edge: true }];
    const els = layout.map((p) => {
      const i = body.indexOf(p);
      const el = pageEl(p, i + 1, posOfSrc);
      if (p.edge) el.classList.add('edge');
      return el;
    });

    // Fixed pixel size, like the leavers flipbook: no re-layout while flipping.
    const book = document.createElement('div');
    book.id = 'book';
    const host = document.createElement('div');
    book.appendChild(host);
    zoomer.appendChild(book);
    place(book);
    flip = new St.PageFlip(host, {
      width: dims.pw, height: dims.ph, size: 'fixed',
      minWidth: 100, maxWidth: 2000, minHeight: 140, maxHeight: 2800,
      showCover: false, usePortrait: true, mobileScrollSupport: false,
      maxShadowOpacity: 0.3, drawShadow: true, flippingTime: FLIP_MS, useMouseEvents: true,
    });
    flip.loadFromHTML(els);
    flip.on('flip', update);
    flip.on('changeOrientation', update);

    if (hereSrc) {
      const idx = layout.findIndex((p) => !p.blank && p.src >= hereSrc);
      if (idx > 1) flip.turnToPage(idx);
    }
    update();
    renderPickerState();
    status.hidden = true;
  }

  /** Largest page size whose spread (or single page on narrow screens) fits the stage. */
  function measure() {
    const aw = wrap.clientWidth - 8, ah = wrap.clientHeight - 8;
    const portrait = aw < 640 || aw / ah < 1.0;
    const ratio = (portrait ? 1 : 2) * pageW / pageH;
    const w = Math.min(aw, ah * ratio);
    return { pw: Math.floor(w / (portrait ? 1 : 2)), ph: Math.floor(w / ratio), portrait };
  }

  function place(book) {
    const w = dims.pw * (dims.portrait ? 1 : 2), h = dims.ph;
    book.style.width = w + 'px';
    book.style.height = h + 'px';
    book.style.left = Math.floor((wrap.clientWidth - w) / 2) + 'px';
    book.style.top = Math.floor((wrap.clientHeight - h) / 2) + 'px';
  }

  function update() { if (flip) applyState(flip.getCurrentPageIndex()); }

  /** Button states and cover/back-cover centring for the spread that starts at page index i. */
  function applyState(i) {
    const n = flip.getPageCount();
    const landscape = flip.getOrientation() === 'landscape';
    const last = landscape ? n - 2 : n - 1;
    prevBtn.disabled = i <= 0;
    nextBtn.disabled = i >= last;
    // Cover and back cover sit alone on one half of the spread: slide the book to centre them.
    const book = $('book');
    let shift = 0;
    if (landscape && i === 0) shift = -25;
    else if (landscape && i >= last) shift = 25;
    if (book) book.style.transform = `translateX(${shift}%)`;
  }

  // ---- zoom -------------------------------------------------------------------
  const FLIP_MS = 480;
  const Z_MIN = 1, Z_MAX = 3;
  let zoom = 1, panX = 0, panY = 0;

  function applyZoom() {
    const mx = (zoom - 1) * wrap.clientWidth / 2, my = (zoom - 1) * wrap.clientHeight / 2;
    panX = Math.max(-mx, Math.min(mx, panX));
    panY = Math.max(-my, Math.min(my, panY));
    if (zoom === 1) panX = panY = 0;
    zoomer.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`;
    wrap.classList.toggle('zoomed', zoom > 1);
    $('zv').textContent = Math.round(zoom * 100) + '%';
    $('zout').disabled = zoom <= Z_MIN;
    $('zin').disabled = zoom >= Z_MAX;
    $('zreset').disabled = zoom === 1;
  }
  function setZoom(z) { zoom = Math.max(Z_MIN, Math.min(Z_MAX, Math.round(z * 100) / 100)); applyZoom(); }

  $('zin').onclick = () => setZoom(zoom + 0.25);
  $('zout').onclick = () => setZoom(zoom - 0.25);
  $('zreset').onclick = () => setZoom(1);

  // drag to pan while zoomed
  let drag = null;
  wrap.addEventListener('pointerdown', (e) => {
    if (zoom <= 1) return;
    drag = { x: e.clientX, y: e.clientY, px: panX, py: panY };
    wrap.classList.add('panning');
    wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!drag) return;
    panX = drag.px + e.clientX - drag.x;
    panY = drag.py + e.clientY - drag.y;
    applyZoom();
  });
  const endDrag = () => { drag = null; wrap.classList.remove('panning'); };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);

  // scroll turns pages, ported from the leavers flipbook: wheel movement is summed to a threshold,
  // then one turn fires; turns requested mid-flip (up to 2) are queued and played straight after.
  let wheelAcc = 0, wheelIdle = 0;
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) { setZoom(zoom * Math.exp(-e.deltaY * 0.01)); return; }
    if (zoom > 1) { panX -= e.deltaX; panY -= e.deltaY; applyZoom(); return; }
    wheelAcc += Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    clearTimeout(wheelIdle);
    wheelIdle = setTimeout(() => { wheelAcc = 0; }, 120);
    if (Math.abs(wheelAcc) >= 50) {
      const dir = wheelAcc > 0 ? 1 : -1;
      wheelAcc = 0;
      go(dir);
    }
  }, { passive: false });

  // ---- turning pages ----------------------------------------------------------
  let busy = false, queued = 0, queuedDir = 0, busyTimer = 0;

  function resetGo() { clearTimeout(busyTimer); busy = false; queued = 0; queuedDir = 0; wheelAcc = 0; }

  function go(dir) {
    if (!flip) return;
    if (busy) {                                           // remember up to two turns for when this one lands
      if (queuedDir && queuedDir !== dir) queued = 0;
      queuedDir = dir;
      queued = Math.min(queued + 1, 2);
      return;
    }
    const landscape = flip.getOrientation() === 'landscape', n = flip.getPageCount();
    const last = landscape ? n - 2 : n - 1, cur = flip.getCurrentPageIndex();
    const target = Math.max(0, Math.min(last, cur + dir * (landscape ? 2 : 1)));
    if (target === cur) { queued = 0; return; }
    busy = true;
    busyTimer = setTimeout(finishGo, FLIP_MS * 0.8);      // free again a little before the animation ends
    applyState(target);                                   // start centring the cover/back now, not after
    if (dir > 0) flip.flipNext(); else flip.flipPrev();
  }

  function finishGo() {
    if (!flip) return;
    if (flip.getState() !== 'read') { busyTimer = setTimeout(finishGo, 16); return; }
    applyState(flip.getCurrentPageIndex());
    busy = false;
    if (queued > 0) { const d = queuedDir; queued--; if (!queued) queuedDir = 0; go(d); }
  }

  // ---- navigation -------------------------------------------------------------
  prevBtn.onclick = () => go(-1);
  nextBtn.onclick = () => go(1);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeAll(); return; }
    if (!flip || /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  });

  // rebuild at the new size when the stage changes (window resize, fonts settling, phone rotation)
  let rz;
  new ResizeObserver(() => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (!flip) { if (catalog) buildBook(); return; }            // first build was skipped (stage had no size yet)
      const d = measure();
      if (d.portrait !== dims.portrait || Math.abs(d.pw - dims.pw) > 2 || Math.abs(d.ph - dims.ph) > 2) buildBook();
      applyZoom();
    }, 150);
  }).observe(wrap);

  // ---- step cards -------------------------------------------------------------
  const heads = [...document.querySelectorAll('.acchd')];
  function closeAll() {
    heads.forEach((h) => { h.setAttribute('aria-expanded', 'false'); $(h.getAttribute('aria-controls')).hidden = true; });
  }
  heads.forEach((h) => h.addEventListener('click', () => {
    const open = h.getAttribute('aria-expanded') === 'true';
    closeAll();
    if (!open) { h.setAttribute('aria-expanded', 'true'); $(h.getAttribute('aria-controls')).hidden = false; }
  }));
  // clicking the book closes an open panel
  $('stage').addEventListener('pointerdown', () => closeAll());

  // ---- product picker ---------------------------------------------------------
  const thumb = (x) => `${base}pages/thumb/p${pad2(x.pages[0])}.jpg?v=${catalog.build}`;
  let rebuildTimer;

  function buildPicker() {
    const root = $('tiers');
    root.innerHTML = '';
    for (const tier of catalog.tiers) {
      const items = catalog.products.filter((x) => x.tier === tier.id);
      const sec = document.createElement('section');
      sec.className = 'tier';
      sec.dataset.tier = tier.id;
      sec.innerHTML =
        `<div class="tierhd"><h3>${esc(tier.name)}</h3><span class="tag">${esc(tier.tagline)}</span>` +
        `<span class="tc"></span><button class="btn" type="button" data-act="on">All</button>` +
        `<button class="btn" type="button" data-act="off">None</button></div><div class="incgrid"></div>`;
      const grid = sec.querySelector('.incgrid');
      for (const x of items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'inc';
        b.dataset.id = x.id;
        b.setAttribute('aria-pressed', 'true');
        b.innerHTML =
          `<span class="th"><img src="${thumb(x)}" alt="" loading="lazy"><span class="tick">✓</span></span>` +
          `<span class="nm">${esc(x.name)}</span><span class="tg">${esc(x.category)}</span>`;
        b.onclick = () => toggle([x.id], !kept.has(x.id));
        grid.appendChild(b);
      }
      sec.querySelector('[data-act=on]').onclick = () => toggle(items.map((x) => x.id), true);
      sec.querySelector('[data-act=off]').onclick = () => toggle(items.map((x) => x.id), false);
      root.appendChild(sec);
    }
    $('all').onclick = () => toggle(catalog.products.map((x) => x.id), true);
    $('none').onclick = () => toggle(catalog.products.map((x) => x.id), false);
  }

  function toggle(ids, on) {
    ids.forEach((id) => (on ? kept.add(id) : kept.delete(id)));
    renderPickerState();
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(buildBook, 200);       // batch rapid taps into one rebuild
  }

  function renderPickerState() {
    document.querySelectorAll('.inc').forEach((b) => {
      const on = kept.has(b.dataset.id);
      b.classList.toggle('off', !on);
      b.setAttribute('aria-pressed', on);
    });
    document.querySelectorAll('.tier').forEach((sec) => {
      const items = catalog.products.filter((x) => x.tier === sec.dataset.tier);
      sec.querySelector('.tc').textContent = `${items.filter((x) => kept.has(x.id)).length} of ${items.length}`;
    });
    const total = catalog.products.length, n = [...kept].length;
    const pages = arrange().length;
    $('count').textContent = `${n} of ${total} products · ${pages} pages`;
    $('sub1').textContent = `${n} of ${total} products · ${pages} pages`;
  }

  /** Header pills to move between brochures (only shown when there is more than one). */
  function renderSwitcher(list, activeId) {
    const nav = $('switch');
    if (!nav || list.length < 2) return;
    nav.innerHTML = list.map((b) =>
      `<a class="pill${b.id === activeId ? ' on' : ''}" href="?b=${encodeURIComponent(b.id)}">${esc(b.label)}</a>`).join('');
  }

  // ---- api / init -------------------------------------------------------------
  function setKept(ids) {
    const valid = new Set(catalog.products.map((p) => p.id));
    kept = new Set([...ids].filter((id) => valid.has(id)));
    buildBook();
  }

  async function init() {
    let list = [];
    try {
      list = await (await fetch('brochures.json?t=' + Date.now(), { cache: 'no-store' })).json();
    } catch (e) { /* single-brochure fallback below */ }
    const want = new URLSearchParams(location.search).get('b');
    const cur = list.find((b) => b.id === want) || list[0] || { id: '2026ss' };
    base = `brochures/${cur.id}/`;
    renderSwitcher(list, cur.id);
    try {
      catalog = await (await fetch(base + 'catalog.json?t=' + Date.now(), { cache: 'no-store' })).json();
    } catch (e) {
      status.textContent = 'Could not load the brochure data.';
      return;
    }
    [pageW, pageH] = catalog.pageSize;
    $('title').textContent = catalog.title;
    document.title = catalog.title + ' Brochure';

    const fromUrl = new URLSearchParams(location.search).get('kept');
    kept = new Set(fromUrl ? fromUrl.split(',') : catalog.products.map((p) => p.id));
    buildPicker();
    applyZoom();
    setKept(kept);
  }

  window.brochure = { setKept, getKept: () => [...kept], get catalog() { return catalog; } };
  init();
})();
