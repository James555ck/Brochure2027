# Cottonridge 2027 Brochure (customisable)

A flipbook of the Cottonridge 2027 brochure that a customer can make their own. Everything runs in the browser.

**1 Customise** - company name, web address, phone, email and address replace the back page's details; a logo goes top right
on the cover and at the top of the back page's card (with an optional white box behind it); the cover style can be
Grey, Black or White. The back page's QR code is regenerated from the web address.

**2 Choose what goes in your brochure** - tick products and pages (Our story, Why choose us, Our ranges, Any cord. Any hood,
Cord options) in or out. Everything that depends on page order is redrawn straight away:
the index, the printed page numbers, and the "Kids version available on page N", "Adults version on page N" and
"for more info see page N" notes (a note disappears when the page it points to is out).

**3 Download** - not built yet.

## How it works
- `brochures/2027/pages/pNN.jpg` - the PDF pages rendered at 150 dpi. Page numbers, the index text and the page-order notes are
  removed from the images; the viewer draws them. `p01-<style>.jpg` / `p44-<style>.jpg` are the cover and the (cleared) back page per style.
- `brochures/2027/catalog.json` - products, which pages each owns, the options, the notes (`refs`), the defaults and the styles.
- `app.js` - `kept` (what is in the brochure) and `custom` (the customer's details) drive everything. `brochure.setKept([...])`
  or `?kept=meteor,atlas` rebuilds the book. Two-page products (Atlas, Lunar) stay on a left/right spread, with a blank page
  inserted where needed.
- `custom.css` - the form, the cover logo and the back page layout (positions in pt of the 595pt-wide A4 page).
- `lib/page-flip.browser.js` (StPageFlip, MIT) and `lib/qrcode.js` (qrcode-generator, MIT).

## Rebuilding the pages from new PDFs
Needs Python with `pymupdf` and `pillow`. The three PDFs share pages 2-43; only the cover and back differ.

    python tools/build_custom.py "grey.pdf" "black.pdf" "white.pdf" 2027

(`tools/build_pages.py` is the older plain import: it renders a PDF exactly as printed, with nothing customisable.)

## Run it locally

    python -m http.server 8027

then open http://localhost:8027
