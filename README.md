# Cottonridge 2027 Brochure

A flipbook brochure where the viewer chooses which products are in it. Remove a product and its pages drop out,
the remaining pages renumber and the index rebuilds itself. Everything runs in the browser.

Built from `Cottonridge Brochure 3.3.pdf` (44 pages), in the style of the leavers flipbook (`FlipBook`), reusing its page-flip engine (StPageFlip, MIT) with clean app code.

## How it works
- `brochures.json` - the brochures the viewer offers (pills top right). `?b=<id>` opens one.
- `brochures/<id>/pages/pNN.jpg` - each source PDF page rendered at 150 dpi, exactly as printed.
- `brochures/<id>/catalog.json` - tiers, categories, products and which pages each product owns.
  Pages carry a `requires` list (shown if *any* listed product is kept), so shared pages (kids) work.
- `app.js` - `brochure.setKept([...productIds])` rebuilds the book. Also `?kept=meteor,atlas` in the URL.
  Two-page products (Atlas, Lunar) are kept on a left/right spread with blank fillers where needed.
  The index page and page numbers are generated live.
- `tools/build_pages.py` - regenerates `pages/` and `catalog.json` from the PDF (needs `pymupdf`).

```
python tools/build_pages.py "path/to/Brochure.pdf" <brochure-id> ["cover.pdf"]
python -m http.server 8027      # then open http://localhost:8027
```
