# Cottonridge 2027 Brochure (customisable)

A flipbook of the Cottonridge 2027 brochure that a customer can make their own. Everything runs in the browser.
**Every page is rendered from the design files** (the `.dc.html` files in `Desktop\Claude\Brochure 2027 Customisable`), not from PDFs.

**The page** is laid out like the leavers flipbook (`james555ck.github.io/Flipbookshare`): the Cottonridge logo and title across the top with
**Full screen** and **View range online** top right, the three steps as slim tabs, the book in the middle, and a bottom bar with the page
counter (**Page 1 of 42**, **Pages 8-9 of 42** on a spread), a **Show all pages** thumbnail strip (the spread on show is outlined; click a
thumbnail to jump there; the cover, index and back thumbnails are live, so they show the customer's logo and the current index) and the
contact details. Full screen is hidden on browsers that don't support it (iPhone Safari).

**1 Customise** - company name, web address, phone, email and address replace the details on the back page's white card;
a logo goes bottom left on the cover and in the empty top of the back page's card (with an optional white box behind it);
the cover style is Black (the default), Grey or White. The logo areas are large: up to 420 x 200 pt on the cover and
270 x 100 pt on the back card (the page is 595 pt wide).

**2 Choose what goes in your brochure** - tick products and pages in or out. Pages: Our story and Why choose us (both start
switched off), Our ranges, Any cord. Any hood, Cord options. Products: every garment in Base, Better, Best and Kids.
Everything that depends on page order is redrawn straight away: the index, the printed page numbers, and the "Kids version
available on page N", "Adults version on page N" and "for more info see page N" notes (a note disappears when the page it points to is out).

Single-page products flip their layout to suit the page they land on: the design has two styles (photos left / details right,
and the reverse), and `tools/render_html.js` renders both (`pNN.jpg` and a mirrored twin `pNNm.jpg`: photos mirror, the details
column, badges and QR shift as a block, nothing is flipped). The viewer picks the version that matches the side the page ends up on,
and moves the "see page N" notes with the details.

Blank pages are only added where a page genuinely cannot change side: each range's divider (Base, Better, Best, Kids), the
two-page products (Atlas, Lunar), the cord page and the back page open on a left-hand page, and the index sits on a right-hand page.
If removing products leaves an odd page before one of them, one blank goes in before it (at the back of the range, or before
a two-page product).

**3 Download** - not built yet.

## Where the pages come from
`tools/render_html.js` opens two design files in headless Chrome and screenshots every page at 150 dpi:
- `Cottonridge Brochure 2027.dc.html` - "Cover pairs": Current = grey, Option A = white, Option B = black (cover + back page).
  On the back page all text is hidden, leaving the card empty; its printed details become the form's starting values.
- `Cottonridge Brochure 2027 - full -with story pages-.dc.html` - the 44-page edition, for pages 2-43. Before each page is
  captured, what depends on page order is hidden and its position recorded (`render.json`): the printed page number (with its
  colour: white on the photo pages), the "see page N" notes, and the index page's text and rules.

- **Front covers supplied as images** - `brochures/2027/overrides/front-black.jpg`, `front-grey.jpg` and `front-white.jpg` replace the
  rendered fronts on every build. All three have the big COTTONRIDGE lettering up the right side (black: page 1 of
  `Cottonridge Brochure 2027 black.pdf`; grey and white: images supplied 5 Nov, 1342 x 2000). They are fitted to the page exactly, so
  nothing is cut and the hoodie stays lined up with the back page (the 1342 x 2000 images are ~5% narrower than A4, so they are stretched
  by that much; export at A4 proportions to avoid it). On these covers the customer's logo is kept to 310 pt wide so it stays clear of the lettering.
  To change a front cover, replace the file.

## How it works
- `brochures/2027/pages/` - `pNN.jpg` (interior) and `pNNm.jpg` (mirrored twins of the single-page products), `p01-<style>.jpg` / `p44-<style>.jpg` (cover / back per style), `thumb/` (picker tiles).
- `brochures/2027/catalog.json` - products, which pages each owns, the options, the notes, the defaults and the styles.
- `app.js` - `kept` (what is in the brochure) and `custom` (the customer's details) drive everything. `brochure.setKept([...])`
  or `?kept=meteor,atlas` rebuilds the book. Two-page products (Atlas, Lunar) stay on a left/right spread, with a blank page
  inserted where needed.
- `custom.css` - the form, the cover logo, the back page, the index page and the page numbers, all in pt of the 595pt-wide A4 page
  and measured from the design file.
- `lib/page-flip.browser.js` - StPageFlip (MIT).

## Rebuilding after the design files change
Needs Python with `pillow`, Node (run `npm install` once inside `tools/`) and Google Chrome. Wait for the design folder to finish
syncing first.

    python tools/build_custom.py "C:\Users\tgi-marketing-01\Desktop\Claude\Brochure 2027 Customisable" 2027

(`--skip-render` reuses the pages already rendered. `tools/build_pages.py` is the older plain PDF import, not used by this.)

## Run it locally

    python -m http.server 8027

then open http://localhost:8027
