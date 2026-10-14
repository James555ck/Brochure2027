/* Render the three cover/back pairs from the design file ("Cover pairs" in Cottonridge Brochure 2027.dc.html).
 *
 *   node tools/render_covers.js "<design>.dc.html" brochures/2027/pages
 *
 * Writes p01-<style>.jpg (cover) and p44-<style>.jpg (back page) for style = grey | white | black, at 150 dpi.
 * On the back page every piece of text is hidden, leaving the card empty: the viewer draws the customer's logo and
 * company details there. Needs `npm install playwright-core` and Google Chrome (set CHROME to use another path).
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const [design, outDir] = process.argv.slice(2);
if (!design || !outDir) { console.error(__doc__ || 'usage: node render_covers.js <design.dc.html> <pages dir>'); process.exit(1); }
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// screen index inside the design file -> style id ("Current", "Option A - hoodie on white", "Option B - all black")
const STYLES = [[1, 'grey'], [2, 'white'], [3, 'black']];
const SCALE = 150 / 72;

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: SCALE });
  await page.goto('file:///' + path.resolve(design).replace(/\\/g, '/').replace(/ /g, '%20'), { waitUntil: 'load' });
  await page.waitForSelector('[data-screen-label]');
  await page.waitForTimeout(6000);                                   // images are large: let them finish

  // mark the page boxes (A4, 595.28 x 841.89 px) of the three cover pairs; blank out the back pages' text
  const labels = await page.evaluate((styles) => {
    const out = [];
    const screens = document.querySelectorAll('[data-screen-label]');
    for (const [si, id] of styles) {
      const boxes = [...screens[si].querySelectorAll('div')].filter((d) =>
        d.style.position === 'relative' && d.style.width === '595.28px' && d.style.height === '841.89px');
      if (boxes.length !== 2) throw new Error(`screen ${si}: expected front + back, found ${boxes.length}`);
      boxes[0].setAttribute('data-cv', id + '-front');
      boxes[1].setAttribute('data-cv', id + '-back');
      boxes[1].querySelectorAll('*').forEach((el) => {
        if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) el.style.visibility = 'hidden';
      });
      out.push(screens[si].getAttribute('data-screen-label'));
    }
    return out;
  }, STYLES);
  console.log('rendering from:', labels.join(' | '));

  for (const [, id] of STYLES) {
    await page.locator(`[data-cv="${id}-front"]`).screenshot({ path: path.join(outDir, `p01-${id}.jpg`), type: 'jpeg', quality: 82 });
    await page.locator(`[data-cv="${id}-back"]`).screenshot({ path: path.join(outDir, `p44-${id}.jpg`), type: 'jpeg', quality: 82 });
    console.log('wrote', id);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
