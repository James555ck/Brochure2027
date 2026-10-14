"""Build the customisable brochure from the three cover-variant PDFs.

Usage:  python tools/build_custom.py "<grey.pdf>" "<black.pdf>" "<white.pdf>" [brochure-id]

Writes brochures/<id>/pages/*.jpg and brochures/<id>/catalog.json (default id: 2027).

The three PDFs share pages 2-43; only the cover (1) and back page (44) differ. So:
- pages 2-43 are rendered once, from the grey PDF, with everything that depends on the
  page order removed so the viewer can redraw it live:
    * the printed page numbers,
    * the index page text and rules (the photo and white card stay),
    * the "Kids version available on page N" / "Adults version on page N" / "see page N" references.
- the cover and back page are rendered per variant (p01-<variant>.jpg, p44-<variant>.jpg); the back page has
  its card cleared so the viewer can draw the customer's logo, details and QR code there.
- catalog.json lists the products, which pages each one owns, the references and the defaults.
"""
import json
import re
import sys
import time
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_pages as bp  # product list, tiers and page roles are shared with the plain import  # noqa: E402

ROOT = bp.ROOT
DPI, JPG_QUALITY = bp.DPI, bp.JPG_QUALITY
VARIANTS = [("grey", "Grey", False), ("black", "Black", True), ("white", "White", False)]
BACK = 44
CARD_INNER = pymupdf.Rect(137, 167, 459, 619)       # inside the back page's white card (card is 135,165 - 461,621)
PRINTED = {1: "cover", 2: "story", 3: "offer", 4: "ranges", 5: "index", 42: "cord", 43: "cord", 44: "back"}
# pages a customer can leave out on their own (id, label, source page)
OPTIONS = [("story", "Our story", 2), ("why", "Why choose us", 3), ("ranges", "Our ranges", 4),
           ("cord", "Any cord. Any hood", 42), ("cords", "Cord options", 43)]
OPT_BY_PAGE = {p: i for i, _l, p in OPTIONS}
REF_LINE = re.compile(r"^(Kids version available on page|Adults version on page) (\d+)\.$")


def lines_of(page):
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            yield l


def line_text(l):
    return "".join(s["text"] for s in l["spans"]).strip()


def hexcolor(c):
    return "#%06x" % c


def strip_and_collect(page, n):
    """Remove page-order-dependent text from an interior page. Returns (num_side, refs)."""
    num, refs = None, []
    for l in lines_of(page):
        t = line_text(l)
        x0, y0, x1, y1 = l["bbox"]
        if t.isdigit() and int(t) == n and y0 > 780:                      # the printed page number
            num = "right" if x0 > 300 else "left"
            page.add_redact_annot(pymupdf.Rect(l["bbox"]), fill=False)
            continue
        m = REF_LINE.match(t)
        if m:                                                              # "Kids version available on page 37."
            refs.append({"page": n, "kind": "xref", "x": round(x0, 1), "y": round(y0, 1), "base": round(l["spans"][0]["origin"][1], 2),
                         "size": round(l["spans"][0]["size"], 1), "color": hexcolor(l["spans"][0]["color"]),
                         "tpl": m.group(1) + " {n}.", "target": int(m.group(2))})
            page.add_redact_annot(pymupdf.Rect(l["bbox"]), fill=False)
        elif "for more info see page" in t:                                # "...cord options, for more info see page 43."
            tm = re.search(r"see page (\d+)\.$", t)
            comma = next(s for i, s in enumerate(l["spans"][:-1])
                         if s["text"].strip() == "," and l["spans"][i + 1]["text"].strip() == "for")
            cx0 = comma["bbox"][0]
            refs.append({"page": n, "kind": "tail", "x": round(cx0, 1), "y": round(y0, 1), "base": round(l["spans"][0]["origin"][1], 2),
                         "size": round(l["spans"][0]["size"], 1), "color": hexcolor(l["spans"][0]["color"]),
                         "tpl": ", for more info see page {n}.", "alt": ".", "target": int(tm.group(1))})
            page.add_redact_annot(pymupdf.Rect(cx0 - 0.5, y0, x1 + 1, y1), fill=False)
    if n == 5:                                                             # index: all its text goes
        page.add_redact_annot(page.rect, fill=False)
    page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                          text=pymupdf.PDF_REDACT_TEXT_REMOVE)
    if n == 5:                                                             # ...and so do its thin rules
        for dr in page.get_drawings():
            r = dr["rect"]
            if r.height <= 1.5 and r.width > 400:
                page.add_redact_annot(pymupdf.Rect(r.x0 - 1, r.y0 - 1, r.x1 + 1, r.y1 + 1), fill=False)
        page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                              graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED, text=pymupdf.PDF_REDACT_TEXT_NONE)
    return num, refs


def clear_back_card(page):
    """Paint over everything inside the back page's card (text, QR, icons) in the card's own colour."""
    px = page.get_pixmap(dpi=72, clip=pymupdf.Rect(139, 169, 141, 171), alpha=False)
    r, g, b = px.pixel(0, 0)
    page.draw_rect(CARD_INNER, color=None, fill=(r / 255, g / 255, b / 255))


def back_defaults(page):
    """The text the back page prints today: these become the form's starting values."""
    ls = [(l["bbox"][1], line_text(l)) for l in lines_of(page)
          if line_text(l) and 290 < l["bbox"][1] < 600 and l["bbox"][0] > 150]
    ls.sort()
    texts = [t for _y, t in ls]
    want_start = ["Cottonridge is a trading brand of TGI Corporation Ltd", "TGI Corporation LTD"]
    assert texts[:2] == want_start, texts[:3]
    i = texts.index("Contact us")
    web = next(t for t in texts if t.startswith("cottonridge."))
    return {"trade": texts[0], "name": texts[1], "address": texts[2:i], "email": texts[i + 1], "phone": texts[i + 2], "web": web}


def main(grey, black, white, brochure_id="2027"):
    root = ROOT / "brochures" / brochure_id
    out = root / "pages"
    (out / "thumb").mkdir(parents=True, exist_ok=True)
    for f in list(out.glob("*.jpg")) + list((out / "thumb").glob("*.jpg")):
        f.unlink()

    docs = {"grey": pymupdf.open(grey), "black": pymupdf.open(black), "white": pymupdf.open(white)}
    src = docs["grey"]
    assert len(src) == 44 and all(len(d) == 44 for d in docs.values()), "expected three 44-page PDFs"

    owners = {}
    for pid, *_r, pages in bp.PRODUCTS:
        for p in pages:
            owners.setdefault(p, []).append(pid)

    pages_meta, all_refs = [], []
    for n in range(1, 45):
        meta = {"id": f"p{n:02d}", "src": n}
        if n in bp.DIVIDERS:
            meta.update(kind="divider", tier=bp.DIVIDERS[n])
        elif n in bp.EXTRAS:
            meta.update(kind="extra", tier=bp.EXTRAS[n])
        elif n == bp.KIDS_DIVIDER:
            meta.update(kind="divider", kids=True)
        elif n in PRINTED:
            meta["kind"] = PRINTED[n]
        else:
            meta.update(kind="product", requires=owners[n])
        if n in OPT_BY_PAGE:
            meta["opt"] = OPT_BY_PAGE[n]
        for pid, *_r, pages in bp.PRODUCTS:
            if len(pages) == 2 and n == pages[0]:
                meta["spreadStart"] = True
        pages_meta.append(meta)

        if n in (1, BACK):                                    # per-variant pages: rendered below
            continue
        page = src[n - 1]
        num, refs = strip_and_collect(page, n)
        if num:
            meta["num"] = num
        all_refs += refs
        page.get_pixmap(dpi=DPI, alpha=False).save(out / f"p{n:02d}.jpg", jpg_quality=JPG_QUALITY)
        page.get_pixmap(dpi=48, alpha=False).save(out / "thumb" / f"p{n:02d}.jpg", jpg_quality=72)
        print("rendered", n)

    for vid, _label, _dark in VARIANTS:
        d = docs[vid]
        d[0].get_pixmap(dpi=DPI, alpha=False).save(out / f"p01-{vid}.jpg", jpg_quality=JPG_QUALITY)
        clear_back_card(d[BACK - 1])
        d[BACK - 1].get_pixmap(dpi=DPI, alpha=False).save(out / f"p{BACK}-{vid}.jpg", jpg_quality=JPG_QUALITY)
        print("variant", vid)

    defaults = back_defaults(pymupdf.open(grey)[BACK - 1])
    quote = " ".join(line_text(l) for l in lines_of(pymupdf.open(grey)[4]) if l["bbox"][1] > 755 and not line_text(l).isdigit())
    w, h = src[0].rect.width, src[0].rect.height
    catalog = {
        "title": "Cottonridge 2027",
        "pageSize": [round(w, 2), round(h, 2)],
        "build": str(int(time.time())),
        "live": True,
        "variants": [{"id": v, "label": lb, "dark": dk} for v, lb, dk in VARIANTS],
        "defaultVariant": "grey",
        "defaults": defaults,
        "options": [{"id": i, "label": lb, "page": p} for i, lb, p in OPTIONS],
        "tiers": [{"id": i, "name": nm, "tagline": tg} for i, nm, tg in bp.TIERS],
        "products": [{"id": i, "name": nm, "code": c, "tier": t, "category": cat, "kids": k, "pages": pg}
                     for i, nm, c, t, cat, k, pg in bp.PRODUCTS],
        "pages": pages_meta,
        "refs": all_refs,
        "frontIndex": [{"label": lb, "src": p, "opt": i} for i, lb, p in OPTIONS],
        "indexQuote": quote,
    }
    (root / "catalog.json").write_text(json.dumps(catalog, indent=1), encoding="utf-8")
    print("catalog.json:", len(bp.PRODUCTS), "products,", len(pages_meta), "pages,", len(all_refs), "references")
    print("defaults:", defaults)


if __name__ == "__main__":
    if len(sys.argv) not in (4, 5):
        sys.exit(__doc__)
    main(*sys.argv[1:])
