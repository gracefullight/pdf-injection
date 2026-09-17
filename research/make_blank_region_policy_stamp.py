"""Place a low-contrast policy notice in a known blank PDF page region."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont


TITLE = "UTS ASSESSMENT INTEGRITY NOTICE"


def wrap(text: str, draw: ImageDraw.ImageDraw, font: ImageFont.FreeTypeFont, width: int) -> list[str]:
    lines: list[str] = []
    for paragraph in text.split("\n"):
        if not paragraph.strip():
            lines.append("")
            continue
        current = ""
        for word in paragraph.split():
            candidate = f"{current} {word}".strip()
            if not current or draw.textlength(candidate, font=font) <= width:
                current = candidate
            else:
                lines.append(current)
                current = word
        lines.append(current)
    return lines


def label(alpha: float) -> str:
    return f"{round(alpha * 1000):04d}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("notice", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--page", type=int, default=4, help="One-based page index")
    parser.add_argument("--top-pt", type=float, default=115.0)
    parser.add_argument("--dpi", type=int, default=180)
    parser.add_argument("--alpha", type=float, action="append", required=True)
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
    if any(not 0 < alpha <= 1 for alpha in args.alpha):
        parser.error("each alpha must be in (0, 1]")
    args.output_dir.mkdir(parents=True)

    notice = args.notice.read_text().strip()
    body = notice.removeprefix(TITLE).strip()
    page_index = args.page - 1
    scale = args.dpi / 72.0

    with tempfile.TemporaryDirectory(prefix="blank-region-policy-stamp-") as temp_dir:
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

        title_font = ImageFont.truetype(str(args.font), round(16 * scale))
        body_font = ImageFont.truetype(str(args.font), round(10.5 * scale))
        margin = round(42 * scale)
        top = round(args.top_pt * scale)
        line_height = round(14.5 * scale)
        gap = round(16 * scale)
        probe_draw = ImageDraw.Draw(source_pages[page_index])
        lines = wrap(body, probe_draw, body_font, source_pages[page_index].width - 2 * margin)
        artifacts = []

        try:
            for alpha in args.alpha:
                pages = [page.copy() for page in source_pages]
                stamped = pages[page_index]
                draw = ImageDraw.Draw(stamped)
                gray = 255 - round(255 * alpha)
                color = (gray, gray, gray)
                y = top
                draw.text((margin, y), TITLE, font=title_font, fill=color)
                y += round(22 * scale) + gap
                for line in lines:
                    if line:
                        draw.text((margin, y), line, font=body_font, fill=color)
                    y += line_height

                difference = ImageChops.difference(source_pages[page_index], stamped)
                extrema = difference.getextrema()
                histogram = difference.convert("L").histogram()
                changed = sum(histogram[1:])
                total = stamped.width * stamped.height
                difference.close()

                filename = f"uts-notice-blank-page-p{args.page}-contrast-{label(alpha)}.pdf"
                output = args.output_dir / filename
                preview = args.output_dir / f"preview-{label(alpha)}.png"
                stamped.save(preview)
                try:
                    pages[0].save(
                        output,
                        "PDF",
                        resolution=float(args.dpi),
                        save_all=True,
                        append_images=pages[1:],
                    )
                finally:
                    for page in pages:
                        page.close()

                artifacts.append(
                    {
                        "alpha": alpha,
                        "filename": filename,
                        "preview": preview.name,
                        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                        "max_channel_delta": max(channel[1] for channel in extrema),
                        "changed_pixel_ratio": changed / total,
                        "page": args.page,
                        "stamp_box_pixels": [margin, top, stamped.width - margin, y],
                    }
                )
        finally:
            for page in source_pages:
                page.close()

    manifest = {
        "source": str(args.source),
        "notice": str(args.notice),
        "dpi": args.dpi,
        "font": str(args.font),
        "method": "low-contrast raster text placed in an existing blank page region",
        "artifacts": artifacts,
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
