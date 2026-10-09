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
  let kept = new Set();
  let flip = null;
  let layout = [];          // final ordered pages (source page objects or { blank: true })
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
    if (p.kind === 'cover' || p.kind === 'back') el.dataset.density = 'hard';
    if (p.blank) { el.classList.add('blank'); return el; }
    if (p.kind === 'index') { el.classList.add('index'); el.innerHTML = indexHTML(posOfSrc); }
    else {
      const img = document.createElement('img');
      img.src = `pages/${p.id}.jpg`;
      img.alt = '';
      img.draggable = false;
      el.appendChild(img);
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
    const row = (label, src) => `<div class="row"><span>${esc(label)}</span><span>${pad2(posOfSrc[src])}</span></div>`;
    let html = '<div class="idx"><h2>Index</h2>';
    html += '<div class="front">' + catalog.frontIndex.map((f) => row(f.label, f.src)).join('') + '</div>';
    const back = catalog.backIndex.map((f) => row(f.label, f.src)).join('');

    for (const tier of catalog.tiers) {
      const items = catalog.products.filter((x) => x.tier === tier.id && kept.has(x.id));
      if (!items.length) continue;
      const cats = [...new Set(items.map((x) => x.category))];
      html += `<div class="itier"><div class="tname">${esc(tier.name)}</div>`;
      for (const cat of cats) {
        html += `<div class="cat"><div class="cname">${esc(cat)}</div><div class="items">`;
        for (const x of items.filter((i) => i.category === cat)) {
          const last = x.pages[x.pages.length - 1];
          html += `<div class="item"><span>${esc(x.name)} <span class="code">(${esc(x.code)})</span></span><span>${pad2(posOfSrc[last])}</span></div>`;
        }
        html += '</div></div>';
      }
      html += '</div>';
    }
    html += `<div class="front" style="margin-top:4cqw">${back}</div></div>`;
    if (['vulcan', 'prostar', 'andromeda'].some((id) => kept.has(id)))
      html += '<div class="quote">“We’re so happy you’re launching a Workwear Hoodie, Polo and T-shirt so we can finally offer our customers a full workwear bundle.”</div>';
    return html;
  }

  // ---- book -------------------------------------------------------------------
  function buildBook() {
    // remember where the reader was so a change in the picker doesn't throw them back to the cover
    const here = flip && layout[flip.getCurrentPageIndex()];
    const hereSrc = here && !here.blank ? here.src : null;

    if (flip) { try { flip.destroy(); } catch (e) { /* already gone */ } flip = null; }
    zoomer.innerHTML = '';

    layout = arrange();
    const posOfSrc = {};
    layout.forEach((p, i) => { if (!p.blank) posOfSrc[p.src] = i + 1; });

    // The engine sizes itself from its container's parent, so give it a frame we control.
    const book = document.createElement('div');
    book.id = 'book';
    const host = document.createElement('div');
    book.appendChild(host);
    zoomer.appendChild(book);
    const els = layout.map((p, i) => pageEl(p, i + 1, posOfSrc));

    fit(book);
    flip = new St.PageFlip(host, {
      width: pageW, height: pageH, size: 'stretch',
      minWidth: 200, maxWidth: 1400, minHeight: 280, maxHeight: 2000,
      showCover: true, usePortrait: true, mobileScrollSupport: false,
      maxShadowOpacity: 0.35, drawShadow: true, flippingTime: 700, startZIndex: 0,
    });
    flip.loadFromHTML(els);
    flip.on('flip', update);
    flip.on('changeOrientation', update);

    if (hereSrc) {
      let idx = layout.findIndex((p) => !p.blank && p.src >= hereSrc);
      if (idx < 0) idx = layout.length - 1;
      if (idx > 0) flip.turnToPage(idx);
    }
    update();
    renderPickerState();
    status.hidden = true;
  }

  /** Size the book frame to the largest spread (or single page on narrow screens) that fits. */
  function fit(book) {
    book = book || $('book');
    if (!book) return;
    const aw = wrap.clientWidth - 8, ah = wrap.clientHeight - 8;
    const portrait = aw < 640 || aw / ah < 1.0;
    const ratio = (portrait ? 1 : 2) * pageW / pageH;
    let w = Math.min(aw, ah * ratio), h = w / ratio;
    w = Math.floor(w); h = Math.floor(h);
    book.style.width = w + 'px';
    book.style.height = h + 'px';
    book.style.left = Math.floor((wrap.clientWidth - w) / 2) + 'px';
    book.style.top = Math.floor((wrap.clientHeight - h) / 2) + 'px';
  }

  function update() {
    if (!flip) return;
    const i = flip.getCurrentPageIndex(), n = flip.getPageCount();
    prevBtn.disabled = i <= 0;
    nextBtn.disabled = i >= n - 1;
    // Cover and back cover sit alone on one half of the spread: slide the book to centre them.
    const book = $('book');
    const landscape = flip.getOrientation() === 'landscape';
    let shift = 0;
    if (landscape && i === 0) shift = -25;
    else if (landscape && i >= n - 1 && n % 2 === 0) shift = 25;
    if (book) book.style.transform = `translateX(${shift}%)`;
  }

  // ---- zoom -------------------------------------------------------------------
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

  // scroll turns pages; ctrl/cmd + scroll zooms
  let wheelLock = 0;
  wrap.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(zoom - e.deltaY * 0.005); return; }
    if (zoom > 1) { panX -= e.deltaX; panY -= e.deltaY; applyZoom(); e.preventDefault(); return; }
    e.preventDefault();
    const now = Date.now();
    if (!flip || now < wheelLock || Math.abs(e.deltaY) + Math.abs(e.deltaX) < 20) return;
    wheelLock = now + 700;
    (e.deltaY + e.deltaX > 0) ? flip.flipNext() : flip.flipPrev();
  }, { passive: false });

  // ---- navigation -------------------------------------------------------------
  prevBtn.onclick = () => flip && flip.flipPrev();
  nextBtn.onclick = () => flip && flip.flipNext();
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeAll(); return; }
    if (!flip || /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    if (e.key === 'ArrowRight') flip.flipNext();
    else if (e.key === 'ArrowLeft') flip.flipPrev();
  });

  // refit whenever the stage changes size (window resize, fonts settling, phone rotation)
  let rz;
  new ResizeObserver(() => {
    clearTimeout(rz);
    rz = setTimeout(() => { if (flip) { fit(); flip.update(); update(); applyZoom(); } }, 100);
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
  const thumb = (x) => `pages/thumb/p${pad2(x.pages[0])}.jpg`;
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

  // ---- api / init -------------------------------------------------------------
  function setKept(ids) {
    const valid = new Set(catalog.products.map((p) => p.id));
    kept = new Set([...ids].filter((id) => valid.has(id)));
    buildBook();
  }

  async function init() {
    try {
      catalog = await (await fetch('catalog.json')).json();
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
