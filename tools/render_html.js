/* Render the brochure's pages from the design files (no PDFs).
 *
 *   node tools/render_html.js "<design folder>" brochures/2027
 *
 * Reads, from the design folder:
 *   Cottonridge Brochure 2027.dc.html                              "Cover pairs": Current = grey, Option A = white, Option B = black
 *   Cottonridge Brochure 2027 - full -with story pages-.dc.html    the 44-page edition (interior pages 2-43)
 * Writes, into brochures/<id>/:
 *   pages/p01-<style>.jpg, p44-<style>.jpg   cover and back page per style (the back page's text is hidden: empty card)
 *   pages/pNN.jpg  (2-43)                    interior pages, 150 dpi, with everything that depends on page order hidden:
 *                                            the printed page number, the "Kids version / Adults version / see page N" notes,
 *                                            and on the index page all text and rules
 *   render.json                              where those hidden things were (number side/colour, notes, index quote, back-page defaults)
 * tools/build_custom.py then makes the thumbnails and catalog.json from these.
 *
 * Needs `npm install` in tools/ (playwright-core) and Google Chrome (set CHROME to use another path).
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const [designDir, outDir] = process.argv.slice(2);
if (!designDir || !outDir) { console.error('usage: node tools/render_html.js "<design folder>" brochures/<id>'); process.exit(1); }
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MAIN = 'Cottonridge Brochure 2027.dc.html';
const FULL = 'Cottonridge Brochure 2027 - full -with story pages-.dc.html';
const STYLES = [[1, 'grey'], [2, 'white'], [3, 'black']];       // screen index in MAIN -> style id (Current, Option A, Option B)
const SCALE = 150 / 72;
const ASC = 0.96875;                                              // Inter ascent per em: text baseline = top of text box + ASC * font size

const fileUrl = (f) => 'file:///' + path.resolve(designDir, f).replace(/\\/g, '/').replace(/ /g, '%20');
const pagesDir = path.join(outDir, 'pages');

async function openDesign(browser, file) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: SCALE });
  await page.goto(fileUrl(file), { waitUntil: 'load' });
  await page.waitForSelector('[data-screen-label]');
  await page.waitForTimeout(3000);
  // the artwork is large: make sure every image (background or <img>) has loaded before anything is captured
  await page.evaluate(async () => {
    const urls = new Set();
    document.querySelectorAll('*').forEach((el) => {
      for (const m of getComputedStyle(el).backgroundImage.matchAll(/url\("?([^")]+)"?\)/g)) urls.add(m[1]);
      if (el.tagName === 'IMG' && el.src) urls.add(el.src);
    });
    await Promise.all([...urls].map((u) => new Promise((res) => { const i = new Image(); i.onload = i.onerror = res; i.src = u; })));
  });
  await page.waitForTimeout(1500);
  return page;
}

/** Tag every A4 page box inside the screens with data-pg = page number, or (cover pairs) data-cv = style-front/back. */
const BOX = (d) => d.style.position === 'relative' && d.style.width === '595.28px' && d.style.height === '841.89px';

async function main() {
  fs.mkdirSync(pagesDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const render = { nums: {}, refs: [], quote: '', defaults: null };

  // ---- cover pairs -----------------------------------------------------------
  {
    const page = await openDesign(browser, MAIN);
    const info = await page.evaluate(([styles, boxSrc]) => {
      const isBox = new Function('d', 'return ' + boxSrc);
      const screens = document.querySelectorAll('[data-screen-label]');
      const labels = [];
      let defaults = null;
      for (const [si, id] of styles) {
        const boxes = [...screens[si].querySelectorAll('div')].filter(isBox);
        if (boxes.length !== 2) throw new Error(`screen ${si}: expected front + back, found ${boxes.length}`);
        boxes[0].setAttribute('data-cv', id + '-front');
        boxes[1].setAttribute('data-cv', id + '-back');
        if (!defaults) {                                        // the back page's printed details become the form's defaults
          const t = [];
          boxes[1].querySelectorAll('*').forEach((el) => {
            if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) t.push(el.innerText.trim());
          });
          const i = t.indexOf('Contact us');
          defaults = { name: t[0], address: t[1].split('\n').map((s) => s.trim()).filter(Boolean),
            email: t[i + 1].split('\n')[0].trim(), phone: (t[i + 1].split('\n')[1] || '').trim(), web: t[t.length - 1] };
        }
        boxes[1].querySelectorAll('*').forEach((el) => {          // empty the back page's card
          if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) el.style.visibility = 'hidden';
        });
        labels.push(screens[si].getAttribute('data-screen-label'));
      }
      return { labels, defaults };
    }, [STYLES, BOX.toString().replace(/^\(d\) => /, '')]);
    render.defaults = info.defaults;
    console.log('cover pairs:', info.labels.join(' | '));
    for (const [, id] of STYLES) {
      await page.locator(`[data-cv="${id}-front"]`).screenshot({ path: path.join(pagesDir, `p01-${id}.jpg`), type: 'jpeg', quality: 82 });
      await page.locator(`[data-cv="${id}-back"]`).screenshot({ path: path.join(pagesDir, `p44-${id}.jpg`), type: 'jpeg', quality: 82 });
    }
    await page.close();
  }

  // ---- interior pages 2-43 -----------------------------------------------------
  {
    const page = await openDesign(browser, FULL);
    const tagged = await page.evaluate(([boxSrc, asc]) => {
      const isBox = new Function('d', 'return ' + boxSrc);
      const result = { pages: [], nums: {}, refs: [], quote: '' };
      document.querySelectorAll('[data-screen-label]').forEach((scr) => {
        const nums = (scr.getAttribute('data-screen-label').match(/\d+/g) || []).map(Number);
        [...scr.querySelectorAll('div')].filter(isBox).forEach((box, i) => {
          const n = nums.length === 1 ? nums[0] : nums[i];
          if (n < 2 || n > 43) return;
          box.setAttribute('data-pg', n);
          result.pages.push(n);
          const r0 = box.getBoundingClientRect();

          // the printed page number
          box.querySelectorAll('div').forEach((el) => {
            if (el.children.length === 0 && el.textContent.trim() === String(n) && getComputedStyle(el).position === 'absolute') {
              const r = el.getBoundingClientRect();
              if (r.top - r0.top > 780) {
                result.nums[n] = { side: r.left - r0.left > 300 ? 'right' : 'left', color: getComputedStyle(el).color };
                el.style.visibility = 'hidden';
              }
            }
          });

          // "Kids version available on page 37." / "Adults version on page 8." / "..., for more info see page 43."
          const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
          const nodes = [];
          while (walker.nextNode()) nodes.push(walker.currentNode);
          for (const t of nodes) {
            const text = t.textContent;
            let m = /^\s*(Kids version available on page|Adults version on page) (\d+)\.\s*$/.exec(text);
            if (m) {
              const el = t.parentElement, cs = getComputedStyle(el);
              const rg = document.createRange(); rg.selectNodeContents(t); const r = rg.getBoundingClientRect();
              const fs = parseFloat(cs.fontSize);
              result.refs.push({ page: n, kind: 'xref', x: +(r.left - r0.left).toFixed(1), base: +(r.top - r0.top + asc * fs).toFixed(2),
                size: fs, color: cs.color, tpl: m[1] + ' {n}.', target: Number(m[2]) });
              el.style.visibility = 'hidden';
              continue;
            }
            m = /^([\s\S]*?)(, for more info see page )(\d+)\.\s*$/.exec(text);
            if (m) {
              const el = t.parentElement, cs = getComputedStyle(el);
              const fs = parseFloat(cs.fontSize);
              t.textContent = m[1];
              const tail = document.createElement('span');
              tail.textContent = m[2] + m[3] + '.';
              t.after(tail);
              const rg = document.createRange(); rg.selectNodeContents(tail); const r = rg.getBoundingClientRect();
              result.refs.push({ page: n, kind: 'tail', x: +(r.left - r0.left).toFixed(1), base: +(r.top - r0.top + asc * fs).toFixed(2),
                size: fs, color: cs.color, tpl: ', for more info see page {n}.', alt: '.', target: Number(m[3]) });
              tail.style.visibility = 'hidden';
            }
          }

          // the index page: every word and every rule is redrawn by the viewer
          if (n === 5) {
            const q = nodes.find((t) => /so happy you/.test(t.textContent));
            if (q) result.quote = q.textContent.trim();
            box.querySelectorAll('*').forEach((el) => {
              const own = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
              const r = el.getBoundingClientRect();
              if (own || (r.height <= 2 && r.width > 400)) el.style.visibility = 'hidden';
            });
          }
        });
      });
      return result;
    }, [BOX.toString().replace(/^\(d\) => /, ''), ASC]);
    if (tagged.pages.length !== 42) throw new Error('expected interior pages 2-43, found ' + tagged.pages.length);
    Object.assign(render, { nums: tagged.nums, refs: tagged.refs, quote: tagged.quote });
    for (const n of tagged.pages) {
      await page.locator(`[data-pg="${n}"]`).screenshot({ path: path.join(pagesDir, `p${String(n).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 82 });
      process.stdout.write(n + ' ');
    }
    console.log('\ninterior pages rendered:', tagged.pages.length, '| numbers:', Object.keys(tagged.nums).length, '| notes:', tagged.refs.length);
    await page.close();
  }

  fs.writeFileSync(path.join(outDir, 'render.json'), JSON.stringify(render, null, 1));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
