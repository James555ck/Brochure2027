"""Render the source PDF into per-page JPGs and write catalog.json.

Usage:  python tools/build_pages.py "<path to Brochure PDF>" <brochure-id> ["<PDF whose page 1 replaces the cover>"]

Writes brochures/<brochure-id>/pages/*.jpg and brochures/<brochure-id>/catalog.json.
List the brochure in brochures.json so the viewer offers it.

- Printed page numbers (real text in the PDF) are removed from the renders; the
  viewer draws live numbers instead, so they stay right after pages are removed.
- The index page (p05) is rendered without its text and rules (just the photo and white card);
  the viewer draws the index on top from catalog.json.
- The catalog (tiers / categories / products / which page needs which product)
  is defined here by hand, taken from the brochure's own index.
"""
import json
import sys
import time
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
DPI = 150
JPG_QUALITY = 82

# ---- catalogue --------------------------------------------------------------
# product: id, name, code, tier, category, kids, pages (1-based source pages)
BASE, BETTER, BEST = "base", "better", "best"
PH, ZH, SW = "Pullover Hoodies", "Zipped Hoodies", "Sweatshirts"
PRODUCTS = [
    # Base
    ("meteor", "Meteor", "CR01 v2.0", BASE, PH, False, [7]),
    ("apollo", "Apollo", "CR02 v2.0", BASE, PH, False, [8]),
    ("apollo-k", "Apollo Kids", "CR02K v2.0", BASE, PH, True, [37]),
    ("vulcan", "Vulcan", "CR10", BASE, PH, False, [15]),
    ("nebula", "Nebula", "CR04 v2.0", BASE, ZH, False, [10]),
    ("nebula-k", "Nebula Kids", "CR04K v2.0", BASE, ZH, True, [38]),
    ("solar", "Solar", "CR03 v2.0", BASE, SW, False, [9]),
    ("solar-k", "Solar Kids", "CR03K v2.0", BASE, SW, True, [37]),
    ("juno", "Juno", "CR08", BASE, "Full Zip Sweatshirt", False, [14]),
    ("atlas", "Atlas", "CR06", BASE, "Quarter Zip Hoodies", False, [12, 13]),
    ("astra", "Astra", "CR05", BASE, "Joggers", False, [11]),
    ("astra-k", "Astra Kids", "CR05K", BASE, "Joggers", True, [38]),
    # Better
    ("orion", "Orion", "W72", BETTER, PH, False, [17]),
    ("orion-k", "Orion Kids", "W72K", BETTER, PH, True, [39]),
    ("eclipse", "Eclipse", "W73", BETTER, PH, False, [18]),
    ("eclipse-k", "Eclipse Kids", "W73K", BETTER, PH, True, [40]),
    ("horizon", "Horizon", "CR11", BETTER, PH, False, [21]),
    ("odyssey", "Odyssey", "CR12", BETTER, SW, False, [20]),
    ("cassini", "Cassini", "W88", BETTER, ZH, False, [19]),
    ("cassini-k", "Cassini Kids", "W88K", BETTER, ZH, True, [40]),
    ("lunar", "Lunar", "W75", BETTER, "Quarter Zip Sweatshirts", False, [22, 23]),
    # Best
    ("gemini", "Gemini", "W76", BEST, PH, False, [25]),
    ("titan", "Titan", "W89PF", BEST, PH, False, [28]),
    ("saturn", "Saturn", "W29PF", BEST, PH, False, [30]),
    ("quasar", "Quasar", "W59PF v2.0", BEST, PH, False, [32]),
    ("comet", "Comet", "W81PF", BEST, ZH, False, [29]),
    ("jupiter", "Jupiter", "W41PF", BEST, ZH, False, [31]),
    ("neptune", "Neptune", "W51PF v2.0", BEST, ZH, False, [33]),
    ("venus", "Venus", "F15", BEST, ZH, False, [34]),
    ("prostar", "Prostar", "CR07", BEST, "Polo Shirts", False, [26]),
    ("andromeda", "Andromeda", "CR09", BEST, "T-Shirts", False, [27]),
    ("andromeda-k", "Andromeda Kids", "CR09K", BEST, "T-Shirts", True, [41]),
]
TIERS = [
    (BASE, "Base", "Our core level, built above standard"),
    (BETTER, "Better", "Added weight, easy to sell as an upgrade"),
    (BEST, "Best", "Retail-quality, luxurious hoodies without the designer price tag"),
]
# page -> role. Anything not listed here is a product page (owned via PRODUCTS).
FIXED = {1: "cover", 2: "story", 3: "offer", 4: "ranges", 5: "index", 42: "cord", 43: "cord", 44: "back"}
DIVIDERS = {6: BASE, 16: BETTER, 24: BEST}          # shown if any product in the tier is kept
EXTRAS = {35: BEST}                                  # tier extras (photo grid / quote)
KIDS_DIVIDER = 36                                    # shown if any kids product is kept
# Index entries that are not products: (label, page)
FRONT_INDEX = [("Our story", 2), ("Why choose us", 3), ("Our ranges", 4), ("Cord change", 42), ("Cord options", 43)]
BACK_INDEX = []
INDEX_PAGE = 5

# LIVE=False: import the PDF exactly as printed (its own index and page numbers).
# LIVE=True: strip the printed numbers/index text so the viewer can redraw them after pages are removed.
LIVE = False


def main(pdf_path: str, brochure_id: str, cover_path: str | None = None) -> None:
    root = ROOT / "brochures" / brochure_id
    src = pymupdf.open(pdf_path)
    cover = pymupdf.open(cover_path) if cover_path else None
    out = root / "pages"
    (out / "thumb").mkdir(parents=True, exist_ok=True)

    owners: dict[int, list[str]] = {}
    for pid, *_rest, pages in PRODUCTS:
        for p in pages:
            owners.setdefault(p, []).append(pid)

    pages_meta = []
    for n in range(1, len(src) + 1):
        page = cover[0] if (n == 1 and cover) else src[n - 1]
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

        if LIVE:
            # strip the printed page number (text only; photos/graphics untouched)
            for b in page.get_text("dict")["blocks"]:
                for l in b.get("lines", []):
                    for s in l["spans"]:
                        t = s["text"].strip()
                        if t.isdigit() and int(t) == n and s["bbox"][1] > 780:
                            page.add_redact_annot(pymupdf.Rect(s["bbox"]), fill=False)
                            meta["num"] = "right" if s["bbox"][0] > 300 else "left"
            if n == INDEX_PAGE:                         # the index is drawn live: clear all its text first
                page.add_redact_annot(page.rect, fill=False)
            page.apply_redactions(
                images=pymupdf.PDF_REDACT_IMAGE_NONE,
                graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                text=pymupdf.PDF_REDACT_TEXT_REMOVE,
            )
            if n == INDEX_PAGE:                         # ...then its thin horizontal rules (the live index draws its own)
                for dr in page.get_drawings():
                    r = dr["rect"]
                    if r.height <= 1.5 and r.width > 400:
                        page.add_redact_annot(pymupdf.Rect(r.x0 - 1, r.y0 - 1, r.x1 + 1, r.y1 + 1), fill=False)
                page.apply_redactions(
                    images=pymupdf.PDF_REDACT_IMAGE_NONE,
                    graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
                    text=pymupdf.PDF_REDACT_TEXT_NONE,
                )
        pix = page.get_pixmap(dpi=DPI, alpha=False)
        pix.save(out / f"p{n:02d}.jpg", jpg_quality=JPG_QUALITY)
        page.get_pixmap(dpi=48, alpha=False).save(out / "thumb" / f"p{n:02d}.jpg", jpg_quality=72)  # picker tiles
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
        "build": str(int(time.time())),   # stamped on every image URL so a new import never shows cached pages
        "live": LIVE,
        "pages": pages_meta,
        "frontIndex": [{"label": l, "src": p} for l, p in FRONT_INDEX],
        "backIndex": [{"label": l, "src": p} for l, p in BACK_INDEX],
    }
    (root / "catalog.json").write_text(json.dumps(catalog, indent=1), encoding="utf-8")
    print("catalog.json written:", len(PRODUCTS), "products,", len(pages_meta), "pages")


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    main(*sys.argv[1:])
