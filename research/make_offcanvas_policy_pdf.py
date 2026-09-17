"""Create image-only PDFs with a raster policy outside the visible page box.

The visible A4 page remains unchanged. A full-contrast policy notice is either
fused into the same oversized raster XObject or stored as a separate raster
XObject wholly outside the MediaBox. This tests whether a hosted PDF pipeline
extracts raw images rather than only consuming the clipped page rendering.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from make_blank_region_policy_stamp import TITLE, wrap


MODES = ("fused-right", "fused-bottom", "separate-right", "media-crop-right")


def notice_panel(
    notice: str,
    *,
    width_pixels: int,
    height_pixels: int,
    dpi: int,
    font_path: Path,
) -> Image.Image:
    scale = dpi / 72.0
    panel = Image.new("RGB", (width_pixels, height_pixels), "white")
    draw = ImageDraw.Draw(panel)
    title_font = ImageFont.truetype(str(font_path), round(16 * scale))
    body_font = ImageFont.truetype(str(font_path), round(10.5 * scale))
    margin = round(24 * scale)
    line_height = round(14.5 * scale)
    body = notice.removeprefix(TITLE).strip()
    lines = wrap(body, draw, body_font, width_pixels - 2 * margin)
    y = margin
    draw.text((margin, y), TITLE, font=title_font, fill="black")
    y += round(38 * scale)
    for line in lines:
        if line:
            draw.text((margin, y), line, font=body_font, fill="black")
        y += line_height
    if y + margin > height_pixels:
        panel.close()
        raise ValueError(
            f"notice requires {y + margin}px but panel height is {height_pixels}px"
        )
    return panel


def save_pdf(
    pages: list[Image.Image],
    panel: Image.Image,
    output: Path,
    *,
    mode: str,
    target_page: int,
    dpi: int,
    gap_pt: float,
) -> dict[str, object]:
    first_width_pt = pages[0].width * 72 / dpi
    first_height_pt = pages[0].height * 72 / dpi
    pdf = canvas.Canvas(str(output), pagesize=(first_width_pt, first_height_pt), pageCompression=1)
    pdf.setTitle(output.stem)
    pdf.setCreator("pdf-injection off-canvas raster research prototype")
    xobject_geometry: dict[str, object] = {}
    for page_index, page in enumerate(pages):
        page_width_pt = page.width * 72 / dpi
        page_height_pt = page.height * 72 / dpi
        pdf.setPageSize((page_width_pt, page_height_pt))
        if page_index != target_page:
            pdf.drawImage(
                ImageReader(page),
                0,
                0,
                width=page_width_pt,
                height=page_height_pt,
                preserveAspectRatio=False,
                mask=None,
            )
            pdf.showPage()
            continue

        gap_pixels = round(gap_pt * dpi / 72)
        if mode in {"fused-right", "media-crop-right"}:
            carrier = Image.new(
                "RGB",
                (page.width + gap_pixels + panel.width, max(page.height, panel.height)),
                "white",
            )
            carrier.paste(page, (0, 0))
            carrier.paste(panel, (page.width + gap_pixels, 0))
            carrier_width_pt = carrier.width * 72 / dpi
            carrier_height_pt = carrier.height * 72 / dpi
            if mode == "media-crop-right":
                pdf.setPageSize((carrier_width_pt, page_height_pt))
                pdf.setCropBox((0, 0, page_width_pt, page_height_pt))
            pdf.drawImage(
                ImageReader(carrier),
                0,
                page_height_pt - carrier_height_pt,
                width=carrier_width_pt,
                height=carrier_height_pt,
                preserveAspectRatio=False,
                mask=None,
            )
            xobject_geometry = {
                "layout": "single fused raster",
                "page_box_layout": (
                    "oversized MediaBox with original A4 CropBox"
                    if mode == "media-crop-right"
                    else "original MediaBox clips oversized raster"
                ),
                "pixels": [carrier.width, carrier.height],
                "visible_page_pixels": [page.width, page.height],
                "offcanvas_notice_origin_pixels": [page.width + gap_pixels, 0],
            }
            carrier.close()
        elif mode == "fused-bottom":
            carrier = Image.new(
                "RGB",
                (max(page.width, panel.width), page.height + gap_pixels + panel.height),
                "white",
            )
            carrier.paste(page, (0, 0))
            carrier.paste(panel, (0, page.height + gap_pixels))
            carrier_width_pt = carrier.width * 72 / dpi
            carrier_height_pt = carrier.height * 72 / dpi
            offcanvas_height_pt = (gap_pixels + panel.height) * 72 / dpi
            pdf.drawImage(
                ImageReader(carrier),
                0,
                -offcanvas_height_pt,
                width=carrier_width_pt,
                height=carrier_height_pt,
                preserveAspectRatio=False,
                mask=None,
            )
            xobject_geometry = {
                "layout": "single fused raster",
                "pixels": [carrier.width, carrier.height],
                "visible_page_pixels": [page.width, page.height],
                "offcanvas_notice_origin_pixels": [0, page.height + gap_pixels],
            }
            carrier.close()
        else:
            pdf.drawImage(
                ImageReader(page),
                0,
                0,
                width=page_width_pt,
                height=page_height_pt,
                preserveAspectRatio=False,
                mask=None,
            )
            panel_width_pt = panel.width * 72 / dpi
            panel_height_pt = panel.height * 72 / dpi
            pdf.drawImage(
                ImageReader(panel),
                page_width_pt + gap_pt,
                page_height_pt - panel_height_pt,
                width=panel_width_pt,
                height=panel_height_pt,
                preserveAspectRatio=False,
                mask=None,
            )
            xobject_geometry = {
                "layout": "separate off-canvas raster",
                "notice_pixels": [panel.width, panel.height],
                "offcanvas_notice_origin_points": [page_width_pt + gap_pt, page_height_pt - panel_height_pt],
            }
        pdf.showPage()
    pdf.save()
    return xobject_geometry


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("notice", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--mode", choices=MODES, action="append", required=True)
    parser.add_argument("--page", type=int, default=4, help="one-based target page")
    parser.add_argument("--dpi", type=int, default=180)
    parser.add_argument("--sidecar-width-pt", type=float, default=360.0)
    parser.add_argument("--sidecar-height-pt", type=float, default=720.0)
    parser.add_argument("--gap-pt", type=float, default=18.0)
    parser.add_argument(
        "--font",
        type=Path,
        default=Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
    )
    args = parser.parse_args()

    if not args.source.is_file() or not args.notice.is_file() or not args.font.is_file():
        parser.error("source, notice, and font must exist")
    if args.output_dir.exists():
        parser.error("refusing to overwrite an existing output directory")
    args.output_dir.mkdir(parents=True)
    page_index = args.page - 1

    notice = args.notice.read_text().strip()
    with tempfile.TemporaryDirectory(prefix="offcanvas-policy-") as temp_dir:
        prefix = Path(temp_dir) / "page"
        subprocess.run(
            ["pdftoppm", "-r", str(args.dpi), "-png", str(args.source), str(prefix)],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        page_paths = sorted(Path(temp_dir).glob("page-*.png"))
        if not 0 <= page_index < len(page_paths):
            parser.error(f"page must be between 1 and {len(page_paths)}")
        pages = [Image.open(path).convert("RGB") for path in page_paths]
        panel = notice_panel(
            notice,
            width_pixels=round(args.sidecar_width_pt * args.dpi / 72),
            height_pixels=round(args.sidecar_height_pt * args.dpi / 72),
            dpi=args.dpi,
            font_path=args.font,
        )
        artifacts: list[dict[str, object]] = []
        try:
            for mode in args.mode:
                output = args.output_dir / f"uts-policy-offcanvas-{mode}.pdf"
                geometry = save_pdf(
                    pages,
                    panel,
                    output,
                    mode=mode,
                    target_page=page_index,
                    dpi=args.dpi,
                    gap_pt=args.gap_pt,
                )
                artifacts.append(
                    {
                        "mode": mode,
                        "filename": output.name,
                        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                        "page": args.page,
                        "media_box_points": [pages[page_index].width * 72 / args.dpi, pages[page_index].height * 72 / args.dpi],
                        "notice_visible_inside_media_box": False,
                        "geometry": geometry,
                    }
                )
        finally:
            panel.close()
            for page in pages:
                page.close()

    manifest = {
        "source": str(args.source),
        "notice": str(args.notice),
        "dpi": args.dpi,
        "method": "full-contrast raster notice outside the visible PDF MediaBox",
        "extractable_text_expected": False,
        "artifacts": artifacts,
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
