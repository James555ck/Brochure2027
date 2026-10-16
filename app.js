/* Cottonridge 2027 brochure.
 *
 * Two things drive the book:
 *   kept    - what is in the brochure: product ids and page ids ('opt-story' ...).
 *   custom  - the customer's company details, logo and cover style.
 * buildBook() turns `kept` into an ordered page list (dropping pages nobody needs, keeping two-page
 * products on a left/right spread) and redraws everything that depends on page order: the index, the
 * printed page numbers and every "see page N" note. `custom` only touches the cover logo and the back
 * page, so those are refreshed in place without rebuilding the book.
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
  const custom = { variant: null, name: '', web: '', phone: '', email: '', address: '', logo: null, logoRatio: 3, logoBox: 'white' };

  // ---- page list --------------------------------------------------------------
  function isVisible(p) {
    if (p.opt) return kept.has('opt-' + p.opt);
    const keptP = catalog.products.filter((x) => kept.has(x.id));
    switch (p.kind) {
      case 'product': return p.requires.some((id) => kept.has(id));
      case 'divider': return p.kids ? keptP.some((x) => x.kids) : keptP.some((x) => x.tier === p.tier);
      case 'extra': return keptP.some((x) => x.tier === p.tier);
      default: return true;                        // cover, story, offer, ranges, index, cord, back
    }
  }

  /** Pages that must open on a left-hand (even) position, as they do in the design: two-page products (so the photo is
   *  on the left and the details on the right), each range's divider (Base, Better, Best, Kids), the cord page and the back
   *  page. Single-page products are not here: they mirror themselves to suit whichever side they land on. */
  const startsLeft = (p) => p.spreadStart || p.kind === 'divider' || p.kind === 'back' || p.opt === 'cord';

  /** Visible pages in order. Whenever a page that must start on the left would land on the right, a blank page goes in
   *  before it: so when removing products leaves a range with an odd number of pages, the blank ends up at the back of
   *  that range (or before a two-page product) and every divider stays on the side it has in the design. The index must sit on a right-hand
   *  page: if removing pages would put it on the left, a blank goes in straight after the cover instead. */
  function arrange() {
    const lay = (frontBlank) => {
      const out = [];
      for (const p of catalog.pages) {
        if (!isVisible(p)) continue;
        if (startsLeft(p) && (out.length + 1) % 2 === 1) out.push({ blank: true });
        out.push(p);
        if (frontBlank && p.kind === 'cover') out.push({ blank: true });
      }
      return out;
    };
    const plain = lay(false);
    const at = plain.findIndex((p) => p.kind === 'index') + 1;
    return at > 0 && at % 2 === 0 ? lay(true) : plain;
  }

  // ---- page elements ----------------------------------------------------------
  const pad2 = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const variantOf = () => (catalog.variants || []).find((v) => v.id === custom.variant) || null;
  const pageFile = (p) => ((p.kind === 'cover' || p.kind === 'back') && variantOf() ? `${p.id}-${custom.variant}` : p.id);
  /** Single-page products were designed for one side (p.layout: 'R' = photos left / details right, 'L' = the opposite).
   *  Left-hand pages sit at even positions. If the page lands on the other side, use its mirrored twin (pNNm.jpg). */
  const isMirrored = (p, pos) => !!p.layout && p.layout !== (pos % 2 === 0 ? 'L' : 'R');

  function pageEl(p, pos, posOfSrc) {
    const el = document.createElement('div');
    el.className = 'page';
    if (p.blank) { el.classList.add('blank'); return el; }
    const img = document.createElement('img');
    const mirrored = isMirrored(p, pos);
    img.src = `${base}pages/${pageFile(p)}${mirrored ? 'm' : ''}.jpg?v=${catalog.build}`;
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    el.appendChild(img);
    if (p.kind === 'index' && catalog.live) {        // photo + white card from the PDF, index drawn live on top
      el.classList.add('index');
      el.insertAdjacentHTML('beforeend', indexHTML(posOfSrc));
    }
    if (p.kind === 'cover') { el.classList.add('cover'); el.insertAdjacentHTML('beforeend', '<div class="clogo" data-slot="cover"></div>'); }
    if (p.kind === 'back') { el.classList.add('back'); el.insertAdjacentHTML('beforeend', '<div class="backc" data-slot="back"></div>'); }
    if (p.num) {
      const n = document.createElement('span');
      n.className = 'pnum ' + (pos % 2 === 0 ? 'left' : 'right');
      n.textContent = pos;
      if (p.numColor) n.style.color = p.numColor;
      el.appendChild(n);
    }
    const refs = (catalog.refs || []).filter((r) => r.page === p.src);
    if (refs.length) el.insertAdjacentHTML('beforeend', refs.map((r) => refHTML(r, posOfSrc, mirrored)).join(''));
    fillSlots(el);
    return el;
  }

  /** A "see page N" note, redrawn with the page's new number (or dropped when that page is out). */
  function refHTML(r, posOfSrc, mirrored) {
    const n = posOfSrc[r.target];
    const text = n ? r.tpl.replace('{n}', n) : (r.alt || '');
    if (!text) return '';
    // placed by text baseline: with Inter's 1.21 line box the baseline sits .96875em below the top
    const x = mirrored && r.xm != null ? r.xm : r.x;
    return `<span class="xref" style="left:calc(${x} * var(--pt));top:calc(${(r.base - 0.96875 * r.size).toFixed(2)} * var(--pt));` +
      `font-size:calc(${r.size} * var(--pt));color:${r.color}">${esc(text)}</span>`;
  }

  function indexHTML(posOfSrc) {
    const row = (label, src) => `<div class="row"><span>${esc(label)}</span><span>${posOfSrc[src]}</span></div>`;
    let html = '<div class="idx"><h2>Index</h2><div class="flow">';
    const front = [...(catalog.frontIndex || []), ...(catalog.backIndex || [])].filter((f) => !f.opt || kept.has('opt-' + f.opt));
    html += '<section class="sec front">' + front.map((f) => row(f.label, f.src)).join('') + '</section>';

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
      html += `<div class="quote">${esc(catalog.indexQuote)}</div>`;
    return html + '</div>';
  }

  // ---- customer details: cover logo + back page --------------------------------
  function logoHTML(where) {
    if (!custom.logo) return '';
    const max = where === 'cover' ? { w: 420, h: 200 } : { w: 270, h: 100 };
    const w = Math.min(max.w, max.h * custom.logoRatio), h = w / custom.logoRatio;
    return `<div class="lg${custom.logoBox !== 'none' ? ' box ' + custom.logoBox : ''}"><img src="${custom.logo}" alt="" ` +
      `style="width:calc(${w.toFixed(1)} * var(--pt));height:calc(${h.toFixed(1)} * var(--pt))"></div>`;
  }

  /** The back page's card contents. Positions match the design (see custom.css .backc). */
  function backHTML() {
    const name = custom.name.trim();
    const email = custom.email.trim(), phone = custom.phone.trim();
    const addr = custom.address.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 5);
    const web = custom.web.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    let h = '';
    if (custom.logo) h += `<div class="blogo">${logoHTML('back')}</div>`;
    if (name) h += `<div class="b bname">${esc(name)}</div>`;
    if (addr.length) h += `<div class="b baddr">${addr.map(esc).join('<br>')}</div>`;
    if (email || phone) {
      h += '<div class="b bcth">Contact us</div>';
      h += `<div class="b bct">${[email, phone].filter(Boolean).map(esc).join('<br>')}</div>`;
    }
    if (web) {
      const fs = Math.max(9, Math.min(18, 300 / (web.length * 0.57)));      // long web addresses shrink to fit the card
      h += '<div class="b bview">View our full range online</div>';
      h += `<div class="b bweb" style="font-size:calc(${fs.toFixed(1)} * var(--pt))">${esc(web)}</div>`;
    }
    return h;
  }

  /** Refresh the cover logo, back page and cover style everywhere they appear (also inside the engine's temporary copies). */
  function fillSlots(root) {
    root = root || document;
    const dark = !!(variantOf() && variantOf().dark);
    root.querySelectorAll('[data-slot="cover"]').forEach((s) => { s.innerHTML = logoHTML('cover'); });
    root.querySelectorAll('[data-slot="back"]').forEach((s) => {
      s.className = 'backc' + (dark ? ' dark' : '');
      s.innerHTML = backHTML();
    });
    const pages = root.matches && root.matches('.page.cover,.page.back') ? [root] : [...root.querySelectorAll('.page.cover,.page.back')];
    pages.forEach((pg) => {
      pg.classList.toggle('dark', dark);
      const img = pg.querySelector('img');
      const id = pg.classList.contains('cover') ? 'p01' : 'p44';
      if (img && variantOf()) {
        const want = `${base}pages/${id}-${custom.variant}.jpg?v=${catalog.build}`;
        if (img.getAttribute('src') !== want) img.src = want;
      }
    });
  }

  let fillTimer;
  const refreshCustom = () => { clearTimeout(fillTimer); fillTimer = setTimeout(() => fillSlots(document), 60); };

  function initCustom() {
    const d = catalog.defaults;
    const reset = () => Object.assign(custom, { name: d.name, web: d.web, phone: d.phone, email: d.email,
      address: d.address.join('\n'), logo: null, logoBox: 'white', variant: catalog.defaultVariant || null });
    reset();
    const f = { name: $('fName'), web: $('fWeb'), phone: $('fPhone'), email: $('fEmail'), address: $('fAddr') };
    const sync = () => { for (const k in f) f[k].value = custom[k]; renderLogoUi(); renderBoxes(); renderSwatches(); };
    for (const k in f) {
      f[k].placeholder = k === 'address' ? d.address.join('\n') : d[k];
      f[k].addEventListener('input', () => { custom[k] = f[k].value; refreshCustom(); });
    }
    $('logoBtn').onclick = () => $('logoFile').click();
    $('logoClear').onclick = () => { custom.logo = null; renderLogoUi(); refreshCustom(); };
    $('logoFile').addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) { $('logoHint').textContent = 'That file is not an image. Please choose a PNG, JPG or SVG.'; return; }
      const rd = new FileReader();
      rd.onload = () => {
        const im = new Image();
        im.onload = () => {
          custom.logoRatio = im.naturalWidth && im.naturalHeight ? im.naturalWidth / im.naturalHeight : 3;
          custom.logo = rd.result;
          renderLogoUi(file.name);
          refreshCustom();
        };
        im.onerror = () => { $('logoHint').textContent = 'That image could not be read. Try a PNG, JPG or SVG.'; };
        im.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
    $('doneBtn').onclick = () => { fillSlots(document); closeAll(); };
    $('resetBtn').onclick = () => { reset(); sync(); refreshCustom(); };
    $('variantRow').hidden = !(catalog.variants && catalog.variants.length > 1);
    sync();
  }

  function renderLogoUi(name) {
    $('logoClear').hidden = !custom.logo;
    $('logoBtn').textContent = custom.logo ? 'Change logo' : 'Choose your logo';
    if (!custom.logo) $('logoHint').textContent = 'PNG, JPG or SVG.';
    else if (name) $('logoHint').textContent = name;
  }

  /** Background behind the customer's logo: none, white or black. */
  function renderBoxes() {
    const opts = [['none', 'No box'], ['white', 'White box'], ['black', 'Black box']];
    $('boxes').innerHTML = opts.map(([id, label]) =>
      `<button type="button" class="swatch${id === custom.logoBox ? ' on' : ''}" data-b="${id}" aria-pressed="${id === custom.logoBox}">` +
      `<i class="dot ${id === 'none' ? 'none' : id}"></i>${label}</button>`).join('');
    $('boxes').querySelectorAll('.swatch').forEach((b) => {
      b.onclick = () => { custom.logoBox = b.dataset.b; renderBoxes(); refreshCustom(); };
    });
  }

  function renderSwatches() {
    $('swatches').innerHTML = (catalog.variants || []).map((v) =>
      `<button type="button" class="swatch${v.id === custom.variant ? ' on' : ''}" data-v="${v.id}" aria-pressed="${v.id === custom.variant}">` +
      `<i class="dot ${v.id}"></i>${esc(v.label)}</button>`).join('');
    $('swatches').querySelectorAll('.swatch').forEach((b) => {
      b.onclick = () => { custom.variant = b.dataset.v; renderSwatches(); fillSlots(document); };
    });
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

  const tileHTML = (src, name, tag) =>
    `<span class="th"><img src="${src}" alt="" loading="lazy"><span class="tick">✓</span></span>` +
    `<span class="nm">${esc(name)}</span>${tag ? `<span class="tg">${esc(tag)}</span>` : ''}`;

  function group(root, key, title, tagline, tiles) {
    const sec = document.createElement('section');
    sec.className = 'tier';
    sec.dataset.group = key;
    sec.innerHTML =
      `<div class="tierhd"><h3>${esc(title)}</h3><span class="tag">${esc(tagline)}</span>` +
      `<span class="tc"></span><button class="btn" type="button" data-act="on">All</button>` +
      `<button class="btn" type="button" data-act="off">None</button></div><div class="incgrid"></div>`;
    const grid = sec.querySelector('.incgrid');
    for (const t of tiles) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'inc';
      b.dataset.id = t.id;
      b.setAttribute('aria-pressed', 'true');
      b.innerHTML = tileHTML(t.thumb, t.name, t.tag);
      b.onclick = () => toggle([t.id], !kept.has(t.id));
      grid.appendChild(b);
    }
    const ids = tiles.map((t) => t.id);
    sec.querySelector('[data-act=on]').onclick = () => toggle(ids, true);
    sec.querySelector('[data-act=off]').onclick = () => toggle(ids, false);
    root.appendChild(sec);
  }

  const optionIds = () => (catalog.options || []).map((o) => 'opt-' + o.id);
  const allIds = () => [...catalog.products.map((x) => x.id), ...optionIds()];
  // everything starts in, except the optional pages the catalog says start out (Our story, Why choose us)
  const defaultKept = () => [...catalog.products.map((x) => x.id),
    ...(catalog.options || []).filter((o) => o.on !== false).map((o) => 'opt-' + o.id)];

  function buildPicker() {
    const root = $('tiers');
    root.innerHTML = '';
    if (catalog.options && catalog.options.length) {
      group(root, 'pages', 'Pages', 'Introduction and cord pages', catalog.options.map((o) => ({
        id: 'opt-' + o.id, name: o.label, tag: '', thumb: `${base}pages/thumb/p${pad2(o.page)}.jpg?v=${catalog.build}` })));
    }
    for (const tier of catalog.tiers) {
      group(root, tier.id, tier.name, tier.tagline, catalog.products.filter((x) => x.tier === tier.id).map((x) => ({
        id: x.id, name: x.name, tag: x.category, thumb: thumb(x) })));
    }
    $('all').onclick = () => toggle(allIds(), true);
    $('none').onclick = () => toggle(allIds(), false);
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
      const tiles = [...sec.querySelectorAll('.inc')];
      sec.querySelector('.tc').textContent = `${tiles.filter((b) => kept.has(b.dataset.id)).length} of ${tiles.length}`;
    });
    const total = catalog.products.length, n = catalog.products.filter((x) => kept.has(x.id)).length;
    const text = `${n} of ${total} products · ${arrange().length} pages`;
    $('count').textContent = text;
    $('sub2').textContent = text;
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
    const valid = new Set(allIds());
    kept = new Set([...ids].filter((id) => valid.has(id)));
    buildBook();
  }

  async function init() {
    let list = [];
    try {
      list = await (await fetch('brochures.json?t=' + Date.now(), { cache: 'no-store' })).json();
    } catch (e) { /* single-brochure fallback below */ }
    const want = new URLSearchParams(location.search).get('b');
    const cur = list.find((b) => b.id === want) || list[0] || { id: '2027' };
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
    kept = new Set(fromUrl ? fromUrl.split(',') : defaultKept());
    initCustom();
    buildPicker();
    applyZoom();
    setKept(kept);
  }

  window.brochure = { setKept, getKept: () => [...kept], get catalog() { return catalog; } };
  init();
})();
