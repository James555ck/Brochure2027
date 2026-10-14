"""Build the customisable brochure's pages and catalog.

Usage:  python tools/build_custom.py "<interior.pdf>" [brochure-id]        (default id: 2027)
        node tools/render_covers.js "<design>.dc.html" brochures/<id>/pages   (the three cover/back styles)

Writes brochures/<id>/pages/*.jpg and brochures/<id>/catalog.json.

Pages 2-43 come from the PDF and are rendered with everything that depends on the page order removed, so the viewer can
redraw it live:
    * the printed page numbers,
    * the index page text and rules (the photo and white card stay),
    * the "Kids version available on page N" / "Adults version on page N" / "see page N" references.
The cover (p01-<style>.jpg) and back page (p44-<style>.jpg) are NOT made here: tools/render_covers.js renders them from the
design file's "Cover pairs" (Current = grey, Option A = white, Option B = black), with the back page's card left empty for the
customer's logo and details. Rebuilding the interior leaves those files alone.
catalog.json lists the products, which pages each one owns, the references and the defaults.
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
VARIANTS = [("grey", "Grey", False), ("white", "White", False), ("black", "Black", True)]
BACK = 44
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
    return {"name": texts[1], "address": texts[2:i], "email": texts[i + 1], "phone": texts[i + 2], "web": web}


def main(interior, brochure_id="2027"):
    root = ROOT / "brochures" / brochure_id
    out = root / "pages"
    (out / "thumb").mkdir(parents=True, exist_ok=True)
    for f in list(out.glob("p[0-9][0-9].jpg")) + list((out / "thumb").glob("*.jpg")):   # interior only: keep the p01-/p44- style files
        f.unlink()

    src = pymupdf.open(interior)
    assert len(src) == 44, "expected a 44-page PDF"

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

    missing = [f for v, _l, _d in VARIANTS for f in (f"p01-{v}.jpg", f"p{BACK}-{v}.jpg") if not (out / f).exists()]
    if missing:
        print("NOTE: run tools/render_covers.js to create", ", ".join(missing))

    defaults = back_defaults(src[BACK - 1])
    quote = " ".join(line_text(l) for l in lines_of(src[4]) if l["bbox"][1] > 755 and not line_text(l).isdigit())
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
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    main(*sys.argv[1:])
