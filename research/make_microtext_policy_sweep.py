"""Create raster-only PDFs with high-resolution policy microtext.

The policy is rendered below normal body-text size so it appears as a small
administrative texture at fit-page viewing while remaining available to a
high-resolution document OCR path.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont


def parse_candidate(value: str) -> tuple[float, int, int | None]:
    try:
        parts = value.split(":")
        if len(parts) not in {2, 3}:
            raise ValueError
        font_raw, repeats_raw = parts[:2]
        font_pt = float(font_raw)
        repeats = int(repeats_raw)
        gray = int(parts[2]) if len(parts) == 3 else None
    except ValueError as error:
        raise argparse.ArgumentTypeError(
            "candidate must be FONT_PT:REPEATS or FONT_PT:REPEATS:GRAY"
        ) from error
    if not 1.5 <= font_pt <= 8.0:
        raise argparse.ArgumentTypeError("font size must be between 1.5 and 8 points")
    if not 1 <= repeats <= 12:
        raise argparse.ArgumentTypeError("repeats must be between 1 and 12")
    if gray is not None and not 0 <= gray <= 254:
        raise argparse.ArgumentTypeError("candidate gray must be between 0 and 254")
    return font_pt, repeats, gray


def wrap_text(text: str, draw: ImageDraw.ImageDraw, font: ImageFont.FreeTypeFont, width: int) -> list[str]:
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if not current or draw.textlength(candidate, font=font) <= width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def changed_pixel_count(difference: Image.Image) -> int:
    red, green, blue = difference.split()
    red_green = ImageChops.lighter(red, green)
    maximum = ImageChops.lighter(red_green, blue)
    changed = sum(maximum.histogram()[1:])
    red.close()
    green.close()
    blue.close()
    red_green.close()
    maximum.close()
    return changed


def psnr(reference: Image.Image, candidate: Image.Image) -> float:
    difference = ImageChops.difference(reference, candidate)
    histogram = difference.histogram()
    squared_error = sum((value % 256) ** 2 * count for value, count in enumerate(histogram))
    mse = squared_error / (reference.width * reference.height * 3)
    difference.close()
    return math.inf if mse == 0 else 20 * math.log10(255 / math.sqrt(mse))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("policy", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--candidate", type=parse_candidate, action="append", required=True)
    parser.add_argument("--page", type=int, default=4)
    parser.add_argument("--top-pt", type=float, default=118.0)
    parser.add_argument("--dpi", type=int, default=300)
    parser.add_argument("--gray", type=int, default=32)
    parser.add_argument(
        "--font",
        type=Path,
        default=Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
    )
    args = parser.parse_args()

    if not args.source.is_file() or not args.policy.is_file() or not args.font.is_file():
        parser.error("source, policy, and font must exist")
    if args.output_dir.exists():
        parser.error("refusing to overwrite an existing output directory")
    if not 0 <= args.gray <= 254:
        parser.error("gray must be between 0 and 254")
    args.output_dir.mkdir(parents=True)

    policy = " ".join(args.policy.read_text().split())
    page_index = args.page - 1
    scale = args.dpi / 72.0
    with tempfile.TemporaryDirectory(prefix="microtext-policy-") as temp_dir:
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
        artifacts: list[dict[str, object]] = []
        try:
            for font_pt, repeats, candidate_gray in args.candidate:
                gray = args.gray if candidate_gray is None else candidate_gray
                pages = [page.copy() for page in source_pages]
                target = pages[page_index]
                draw = ImageDraw.Draw(target)
                font_pixels = max(1, round(font_pt * scale))
                font = ImageFont.truetype(str(args.font), font_pixels)
                margin = round(36 * scale)
                available_width = target.width - 2 * margin
                lines = wrap_text(policy, draw, font, available_width)
                line_height = max(font_pixels + 1, round(font_pt * 1.35 * scale))
                block_gap = max(2, round(font_pt * 1.8 * scale))
                y = round(args.top_pt * scale)
                for _ in range(repeats):
                    for line in lines:
                        draw.text((margin, y), line, font=font, fill=(gray,) * 3)
                        y += line_height
                    y += block_gap
                if y >= target.height - margin:
                    for page in pages:
                        page.close()
                    parser.error(
                        f"candidate {font_pt}:{repeats} does not fit on page {args.page}"
                    )

                font_label = str(font_pt).replace(".", "p")
                stem = f"uts-policy-microtext-f{font_label}-r{repeats:02d}-g{gray:03d}"
                output = args.output_dir / f"{stem}.pdf"
                preview = args.output_dir / f"{stem}-p{args.page}.png"
                target.save(preview)
                pages[0].save(
                    output,
                    "PDF",
                    resolution=float(args.dpi),
                    save_all=True,
                    append_images=pages[1:],
                )
                difference = ImageChops.difference(source_pages[page_index], target)
                extrema = difference.getextrema()
                changed = changed_pixel_count(difference)
                total = target.width * target.height
                artifacts.append(
                    {
                        "font_pt": font_pt,
                        "font_pixels_at_source_dpi": font_pixels,
                        "repeats": repeats,
                        "line_count_per_repeat": len(lines),
                        "gray": gray,
                        "filename": output.name,
                        "preview": preview.name,
                        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                        "max_channel_delta": max(channel[1] for channel in extrema),
                        "changed_pixel_ratio_page": changed / total,
                        "psnr_db_page": psnr(source_pages[page_index], target),
                        "text_box_pixels": [margin, round(args.top_pt * scale), target.width - margin, y],
                        "page": args.page,
                    }
                )
                difference.close()
                for page in pages:
                    page.close()
        finally:
            for page in source_pages:
                page.close()

    manifest = {
        "source": str(args.source),
        "policy": str(args.policy),
        "policy_sha256": hashlib.sha256(policy.encode()).hexdigest(),
        "dpi": args.dpi,
        "method": "high-contrast raster policy microtext",
        "extractable_text_expected": False,
        "human_subject_legibility_test_completed": False,
        "artifacts": artifacts,
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
