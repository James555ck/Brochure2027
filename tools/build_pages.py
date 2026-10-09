"""Render the source PDF into per-page JPGs and write catalog.json.

Usage:  python tools/build_pages.py "<path to Brochure PDF>"

- Printed page numbers (real text in the PDF) are removed from the renders; the
  viewer draws live numbers instead, so they stay right after pages are removed.
- The index page (p05) is not rendered; the viewer builds it from catalog.json.
- The catalog (tiers / categories / products / which page needs which product)
  is defined here by hand, taken from the brochure's own index.
"""
import json
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
DPI = 150
JPG_QUALITY = 82

# ---- catalogue --------------------------------------------------------------
# product: id, name, code, tier, category, kids, pages (1-based source pages)
BASE, BETTER, BEST = "base", "better", "best"
PRODUCTS = [
    # Base
    ("meteor", "Meteor", "CR01 v2.0", BASE, "Pullover Hoodies", False, [7]),
    ("apollo", "Apollo", "CR02 v2.0", BASE, "Pullover Hoodies", False, [8]),
    ("apollo-k", "Apollo Kids", "CR02K v2.0", BASE, "Pullover Hoodies", True, [35]),
    ("vulcan", "Vulcan", "CR10", BASE, "Pullover Hoodies", False, [15]),
    ("nebula", "Nebula", "CR04 v2.0", BASE, "Zipped Hoodies", False, [10]),
    ("nebula-k", "Nebula Kids", "CR04K v2.0", BASE, "Zipped Hoodies", True, [36]),
    ("solar", "Solar", "CR03 v2.0", BASE, "Sweatshirts", False, [9]),
    ("solar-k", "Solar Kids", "CR03K v2.0", BASE, "Sweatshirts", True, [35]),
    ("juno", "Juno", "CR08", BASE, "Full Zip Sweatshirt", False, [14]),
    ("atlas", "Atlas", "CR06", BASE, "Quarter Zip Hoodies", False, [12, 13]),
    ("astra", "Astra", "CR05", BASE, "Joggers", False, [11]),
    ("astra-k", "Astra Kids", "CR05K", BASE, "Joggers", True, [36]),
    # Better
    ("orion", "Orion", "W72", BETTER, "Pullover Hoodies", False, [17]),
    ("orion-k", "Orion Kids", "W72K", BETTER, "Pullover Hoodies", True, [37]),
    ("eclipse", "Eclipse", "W73", BETTER, "Pullover Hoodies", False, [18]),
    ("eclipse-k", "Eclipse Kids", "W73K", BETTER, "Pullover Hoodies", True, [38]),
    ("cassini", "Cassini", "W88", BETTER, "Zipped Hoodies", False, [19]),
    ("cassini-k", "Cassini Kids", "W88K", BETTER, "Zipped Hoodies", True, [38]),
    ("lunar", "Lunar", "W75", BETTER, "Quarter Zip Sweatshirts", False, [20, 21]),
    # Best
    ("gemini", "Gemini", "W76", BEST, "Pullover Hoodies", False, [23]),
    ("titan", "Titan", "W89PF", BEST, "Pullover Hoodies", False, [26]),
    ("saturn", "Saturn", "W29PF", BEST, "Pullover Hoodies", False, [28]),
    ("quasar", "Quasar", "W59PF v2.0", BEST, "Pullover Hoodies", False, [30]),
    ("comet", "Comet", "W81PF", BEST, "Zipped Hoodies", False, [27]),
    ("jupiter", "Jupiter", "W41PF", BEST, "Zipped Hoodies", False, [29]),
    ("neptune", "Neptune", "W51PF v2.0", BEST, "Zipped Hoodies", False, [31]),
    ("venus", "Venus", "F15", BEST, "Zipped Hoodies", False, [32]),
    ("prostar", "Prostar", "CR07", BEST, "Polo Shirts", False, [24]),
    ("andromeda", "Andromeda", "CR09", BEST, "T-Shirts", False, [25]),
]
TIERS = [
    (BASE, "Base", "Our core level, built above standard"),
    (BETTER, "Better", "Added weight, easy to sell as an upgrade"),
    (BEST, "Best", "Retail-quality, luxurious hoodies without the designer price tag"),
]
# page -> role. Anything not listed here is a product page (owned via PRODUCTS).
FIXED = {1: "cover", 2: "story", 3: "offer", 4: "ranges", 5: "index", 39: "cord", 40: "back"}
DIVIDERS = {6: BASE, 16: BETTER, 22: BEST}          # shown if any product in the tier is kept
EXTRAS = {33: BEST}                                  # tier extras (photo grid / quote)
KIDS_DIVIDER = 34                                    # shown if any kids product is kept
# Index entries that are not products: (label, page)
FRONT_INDEX = [("Our story", 2), ("What we offer", 3), ("Our ranges", 4)]
BACK_INDEX = [("Cord change", 39)]


def main(pdf_path: str) -> None:
    src = pymupdf.open(pdf_path)
    out = ROOT / "pages"
    out.mkdir(exist_ok=True)

    owners: dict[int, list[str]] = {}
    for pid, *_rest, pages in PRODUCTS:
        for p in pages:
            owners.setdefault(p, []).append(pid)

    pages_meta = []
    for n in range(1, len(src) + 1):
        page = src[n - 1]
        meta = {"id": f"p{n:02d}", "src": n}
        if n in FIXED:
            meta["kind"] = FIXED[n]
        elif n in DIVIDERS:
            meta["kind"] = "divider"
            meta["tier"] = DIVIDERS[n]
        elif n in EXTRAS:
            meta["kind"] = "extra"
            meta["tier"] = EXTRAS[n]
        elif n == KIDS_DIVIDER:
            meta["kind"] = "divider"
            meta["kids"] = True
        else:
            meta["kind"] = "product"
            meta["requires"] = owners[n]          # shown if ANY of these is kept
        # two-page products must open on a left-hand page
        for pid, *_r, pages in PRODUCTS:
            if len(pages) == 2 and n == pages[0]:
                meta["spreadStart"] = True
        pages_meta.append(meta)

        # strip the printed page number (text only; photos/graphics untouched)
        for b in page.get_text("dict")["blocks"]:
            for l in b.get("lines", []):
                for s in l["spans"]:
                    t = s["text"].strip()
                    if t.isdigit() and int(t) == n and s["bbox"][1] > 780:
                        page.add_redact_annot(pymupdf.Rect(s["bbox"]), fill=False)
                        meta["num"] = "right" if s["bbox"][0] > 300 else "left"
        page.apply_redactions(
            images=pymupdf.PDF_REDACT_IMAGE_NONE,
            graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
            text=pymupdf.PDF_REDACT_TEXT_REMOVE,
        )

        if n == 5:                                  # index is rebuilt in HTML
            continue
        pix = page.get_pixmap(dpi=DPI, alpha=False)
        pix.save(out / f"p{n:02d}.jpg", jpg_quality=JPG_QUALITY)
        print("rendered", n)

    w, h = src[0].rect.width, src[0].rect.height
    catalog = {
        "title": "Cottonridge 2027",
        "pageSize": [round(w, 2), round(h, 2)],
        "tiers": [{"id": i, "name": n, "tagline": t} for i, n, t in TIERS],
        "products": [
            {"id": i, "name": n, "code": c, "tier": t, "category": cat, "kids": k, "pages": pg}
            for i, n, c, t, cat, k, pg in PRODUCTS
        ],
        "pages": pages_meta,
        "frontIndex": [{"label": l, "src": p} for l, p in FRONT_INDEX],
        "backIndex": [{"label": l, "src": p} for l, p in BACK_INDEX],
    }
    (ROOT / "catalog.json").write_text(json.dumps(catalog, indent=1), encoding="utf-8")
    print("catalog.json written:", len(PRODUCTS), "products,", len(pages_meta), "pages")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
