"""Create raster-only PDFs with policy glyphs carried in selected RGB channels.

The carrier keeps the original page luminance nearly unchanged by placing most
of the contrast in the blue channel. Optional high-frequency masks reduce the
amount of contiguous, human-readable glyph structure while retaining the
low-resolution outline seen after model-side resampling.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

from make_blank_region_policy_stamp import TITLE, wrap


def parse_candidate(value: str) -> tuple[str, int]:
    try:
        mode, raw_delta = value.rsplit(":", 1)
        delta = int(raw_delta)
    except ValueError as error:
        raise argparse.ArgumentTypeError("candidate must be MODE:DELTA") from error
    if mode not in {"blue", "blue-checker", "blue-quarter", "blue-stripe"}:
        raise argparse.ArgumentTypeError(f"unsupported carrier mode: {mode}")
    if not 1 <= delta <= 255:
        raise argparse.ArgumentTypeError("delta must be between 1 and 255")
    return mode, delta


def carrier_mask(width: int, height: int, mode: str) -> Image.Image:
    if mode == "blue":
        return Image.new("L", (width, height), 255)
    carrier = Image.new("L", (width, height), 0)
    pixels = carrier.load()
    for y in range(height):
        for x in range(width):
            if mode == "blue-checker":
                enabled = (x + y) % 2 == 0
            elif mode == "blue-quarter":
                enabled = x % 2 == 0 and y % 2 == 0
            else:
                enabled = y % 3 == 0
            if enabled:
                pixels[x, y] = 255
    return carrier


def render_notice_mask(
    size: tuple[int, int],
    notice: str,
    font_path: Path,
    dpi: int,
    top_pt: float,
    title_pt: float = 16.0,
    body_pt: float = 10.5,
    line_pt: float = 14.5,
) -> tuple[Image.Image, list[int]]:
    scale = dpi / 72.0
    title_font = ImageFont.truetype(str(font_path), round(title_pt * scale))
    body_font = ImageFont.truetype(str(font_path), round(body_pt * scale))
    margin = round(42 * scale)
    top = round(top_pt * scale)
    line_height = round(line_pt * scale)
    gap = round(16 * scale)
    body = notice.removeprefix(TITLE).strip()
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    lines = wrap(body, draw, body_font, size[0] - 2 * margin)
    y = top
    draw.text((margin, y), TITLE, font=title_font, fill=255)
    y += round(22 * scale) + gap
    for line in lines:
        if line:
            draw.text((margin, y), line, font=body_font, fill=255)
        y += line_height
    return mask, [margin, top, size[0] - margin, y]


def apply_blue_carrier(page: Image.Image, glyph_mask: Image.Image, mode: str, delta: int) -> Image.Image:
    carrier = carrier_mask(page.width, page.height, mode)
    effective = ImageChops.multiply(glyph_mask, carrier)
    red, green, blue = page.split()
    amount = effective.point(lambda value: round(value * delta / 255))
    blue = ImageChops.subtract(blue, amount)
    protected = Image.merge("RGB", (red, green, blue))
    carrier.close()
    effective.close()
    amount.close()
    red.close()
    green.close()
    blue.close()
    return protected


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("notice", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--candidate", type=parse_candidate, action="append", required=True)
    parser.add_argument("--page", type=int, default=4)
    parser.add_argument("--top-pt", type=float, default=115.0)
    parser.add_argument("--title-pt", type=float, default=16.0)
    parser.add_argument("--body-pt", type=float, default=10.5)
    parser.add_argument("--line-pt", type=float, default=14.5)
    parser.add_argument("--dpi", type=int, default=180)
    parser.add_argument(
        "--font",
        type=Path,
        default=Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
    )
    args = parser.parse_args()

    if not args.source.is_file() or not args.notice.is_file():
        parser.error("source PDF and notice text are required")
    if not args.font.is_file():
        parser.error(f"missing font: {args.font}")
    if args.output_dir.exists():
        parser.error("refusing to overwrite an existing output directory")
    args.output_dir.mkdir(parents=True)

    page_index = args.page - 1
    notice = args.notice.read_text().strip()
    with tempfile.TemporaryDirectory(prefix="chroma-policy-sweep-") as temp_dir:
        prefix = Path(temp_dir) / "page"
        subprocess.run(
            ["pdftoppm", "-r", str(args.dpi), "-png", str(args.source), str(prefix)],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        page_paths = sorted(Path(temp_dir).glob("page-*.png"))
        if not 0 <= page_index < len(page_paths):
            parser.error(f"page must be between 1 and {len(page_paths)}")
        source_pages = [Image.open(path).convert("RGB") for path in page_paths]
        glyph_mask, stamp_box = render_notice_mask(
            source_pages[page_index].size,
            notice,
            args.font,
            args.dpi,
            args.top_pt,
            args.title_pt,
            args.body_pt,
            args.line_pt,
        )
        artifacts: list[dict[str, object]] = []
        try:
            for mode, delta in args.candidate:
                pages = [page.copy() for page in source_pages]
                protected = apply_blue_carrier(pages[page_index], glyph_mask, mode, delta)
                pages[page_index].close()
                pages[page_index] = protected

                stem = f"uts-policy-{mode}-d{delta:03d}"
                output = args.output_dir / f"{stem}.pdf"
                preview = args.output_dir / f"{stem}-p{args.page}.png"
                protected.save(preview)
                pages[0].save(
                    output,
                    "PDF",
                    resolution=float(args.dpi),
                    save_all=True,
                    append_images=pages[1:],
                )

                difference = ImageChops.difference(source_pages[page_index], protected)
                extrema = difference.getextrema()
                changed = sum(difference.convert("L").histogram()[1:])
                total = protected.width * protected.height
                difference.close()
                artifacts.append(
                    {
                        "mode": mode,
                        "delta": delta,
                        "filename": output.name,
                        "preview": preview.name,
                        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                        "max_channel_delta": max(channel[1] for channel in extrema),
                        "changed_pixel_ratio_page": changed / total,
                        "estimated_rec709_luminance_delta": delta * 0.0722,
                        "page": args.page,
                        "stamp_box_pixels": stamp_box,
                    }
                )
                for page in pages:
                    page.close()
        finally:
            glyph_mask.close()
            for page in source_pages:
                page.close()

    manifest = {
        "source": str(args.source),
        "notice": str(args.notice),
        "dpi": args.dpi,
        "method": "blue-channel policy glyph carrier with optional high-frequency masking",
        "artifacts": artifacts,
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
