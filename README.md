# Cottonridge 2027 Brochure (customisable)

A flipbook of the Cottonridge 2027 brochure that a customer can make their own. Everything runs in the browser.

**1 Customise** - company name, web address, phone, email and address replace the details on the back page's white card;
a logo goes top right on the cover and in the empty top of the back page's card (with an optional white box behind it);
the cover style can be Grey, White (hoodie on white) or Black. The logo areas are large: up to 280 x 120 pt on the cover and
270 x 100 pt on the back card (the page is 595 pt wide).

**2 Choose what goes in your brochure** - tick products and pages (Our story, Why choose us, Our ranges, Any cord. Any hood,
Cord options) in or out. Everything that depends on page order is redrawn straight away:
the index, the printed page numbers, and the "Kids version available on page N", "Adults version on page N" and
"for more info see page N" notes (a note disappears when the page it points to is out).

**3 Download** - not built yet.

## Where the pages come from
- **Cover and back page (three styles)** - the design file `Desktop\Claude\Brochure 2027 Customisable\Cottonridge Brochure 2027.dc.html`,
  "Cover pairs": Current = grey, Option A = white, Option B = black. Rendered by `tools/render_covers.js`, with the back
  page's text hidden so the card is empty for the viewer to fill.
- **Pages 2-43** - the 44-page brochure PDF (`Cottonridge Brochure 2027 grey.pdf`); its interior is identical to the design
  file's 44-page edition (`... - full -with story pages-.dc.html`). `tools/build_custom.py` renders it with the printed page
  numbers, the index text and the "see page N" notes removed.

## How it works
- `brochures/2027/pages/pNN.jpg` (interior), `p01-<style>.jpg` / `p44-<style>.jpg` (cover / back per style), `thumb/` (picker tiles).
- `brochures/2027/catalog.json` - products, which pages each owns, the options, the notes (`refs`), the defaults and the styles.
- `app.js` - `kept` (what is in the brochure) and `custom` (the customer's details) drive everything. `brochure.setKept([...])`
  or `?kept=meteor,atlas` rebuilds the book. Two-page products (Atlas, Lunar) stay on a left/right spread, with a blank page
  inserted where needed.
- `custom.css` - the form, the cover logo and the back page layout (positions in pt of the 595pt-wide A4 page).
- `lib/page-flip.browser.js` - StPageFlip (MIT).

## Rebuilding the pages
Python with `pymupdf` and `pillow`; Node with `npm install` inside `tools/` (playwright-core) and Google Chrome.

    python tools/build_custom.py "Cottonridge Brochure 2027 grey.pdf" 2027
    node tools/render_covers.js "Cottonridge Brochure 2027.dc.html" brochures/2027/pages

(`tools/build_pages.py` is the older plain import: it renders a PDF exactly as printed, with nothing customisable.)

## Run it locally

    python -m http.server 8027

then open http://localhost:8027
