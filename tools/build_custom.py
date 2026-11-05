"""Build the customisable brochure from the design folder.

Usage:  python tools/build_custom.py "<design folder>" [brochure-id] [--skip-render]      (default id: 2027)

The design folder is the one that holds the brochure's .dc.html files (e.g. "Brochure 2027 Customisable"). This runs
tools/render_html.js, which renders every page from those HTML files (see that file for which ones), then makes the
thumbnails and brochures/<id>/catalog.json. --skip-render reuses the pages already rendered.

Nothing comes from a PDF: edit the design files, run this again, and the flipbook follows.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_pages as bp  # product list, tiers and page roles  # noqa: E402

ROOT = bp.ROOT
TOOLS = Path(__file__).resolve().parent
# cover styles in the order the form offers them; the first is the default
VARIANTS = [("black", "Black", True), ("grey", "Grey", False), ("white", "White", False)]
WORDMARK = {"black"}      # covers with the big COTTONRIDGE lettering up the right side: the customer's logo is kept narrower there
PRINTED = {1: "cover", 2: "story", 3: "offer", 4: "ranges", 5: "index", 42: "cord", 43: "cord", 44: "back"}
# pages a customer can leave out on their own (id, label, source page)
OPTIONS = [("story", "Our story", 2), ("why", "Why choose us", 3), ("ranges", "Our ranges", 4),
           ("cord", "Any cord. Any hood", 42), ("cords", "Cord options", 43)]
OPT_BY_PAGE = {p: i for i, _l, p in OPTIONS}
OFF_BY_DEFAULT = {"story", "why"}      # start out of the brochure; the customer can switch them on
THUMB_W = 397


def apply_front_overrides(root):
    """Front covers supplied as finished images (brochures/<id>/overrides/front-<style>.jpg) replace the rendered ones.
    They are scaled to fill the A4 page and trimmed at the top, so the "2027 BROCHURE" line stays at the bottom."""
    out = root / "pages"
    for f in sorted((root / "overrides").glob("front-*.jpg")):
        style = f.stem.split("-", 1)[1]
        W, H = Image.open(out / f"p01-{style}.jpg").size
        im = Image.open(f).convert("RGB")
        k = max(W / im.width, H / im.height)
        im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        left, top = (im.width - W) // 2, im.height - H
        im.crop((left, top, left + W, top + H)).save(out / f"p01-{style}.jpg", quality=88)
        print("front cover override:", style, f.name)


def main(folder, brochure_id="2027", skip_render=False):
    root = ROOT / "brochures" / brochure_id
    out = root / "pages"
    if not skip_render:
        subprocess.run(["node", str(TOOLS / "render_html.js"), folder, str(root)], check=True)
    render = json.loads((root / "render.json").read_text(encoding="utf8"))
    apply_front_overrides(root)

    thumbs = out / "thumb"
    thumbs.mkdir(exist_ok=True)
    for f in thumbs.glob("*.jpg"):
        f.unlink()
    for src in sorted(out.glob("p*.jpg")):                    # picker tiles + the "Show all pages" strip: every page image
        im = Image.open(src).convert("RGB")                   # (interior, mirrored twins pNNm, cover/back per style)
        im.resize((THUMB_W, round(im.height * THUMB_W / im.width)), Image.LANCZOS).save(thumbs / src.name, quality=72)

    owners = {}
    for pid, *_r, pages in bp.PRODUCTS:
        for p in pages:
            owners.setdefault(p, []).append(pid)

    pages_meta = []
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
        if str(n) in render.get("layouts", {}):                    # single-page product: has a mirrored twin (pNNm.jpg)
            meta["layout"] = render["layouts"][str(n)]
        num = render["nums"].get(str(n))
        if num:
            meta["num"], meta["numColor"] = num["side"], num["color"]
        pages_meta.append(meta)

    missing = [f for v, _l, _d in VARIANTS for f in (f"p01-{v}.jpg", "p44-%s.jpg" % v) if not (out / f).exists()]
    assert not missing, f"missing cover/back images: {missing}"
    catalog = {
        "title": "Cottonridge 2027",
        "pageSize": [595.28, 841.89],
        "build": str(int(time.time())),
        "live": True,
        "variants": [{"id": v, "label": lb, "dark": dk, "wordmark": v in WORDMARK} for v, lb, dk in VARIANTS],
        "defaultVariant": VARIANTS[0][0],
        "defaults": render["defaults"],
        "options": [{"id": i, "label": lb, "page": p, "on": i not in OFF_BY_DEFAULT} for i, lb, p in OPTIONS],
        "tiers": [{"id": i, "name": nm, "tagline": tg} for i, nm, tg in bp.TIERS],
        "products": [{"id": i, "name": nm, "code": c, "tier": t, "category": cat, "kids": k, "pages": pg}
                     for i, nm, c, t, cat, k, pg in bp.PRODUCTS],
        "pages": pages_meta,
        "refs": render["refs"],
        "frontIndex": [{"label": lb, "src": p, "opt": i} for i, lb, p in OPTIONS],
        "indexQuote": render["quote"],
    }
    (root / "catalog.json").write_text(json.dumps(catalog, indent=1), encoding="utf-8")
    print("catalog.json:", len(bp.PRODUCTS), "products,", len(pages_meta), "pages,", len(render["refs"]), "notes,",
          len(render["nums"]), "printed numbers")
    print("defaults:", render["defaults"])


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not 1 <= len(args) <= 2:
        sys.exit(__doc__)
    main(args[0], *args[1:], skip_render="--skip-render" in sys.argv)
