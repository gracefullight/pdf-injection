"""Create raster-only PDFs with a text-free academic-integrity pictogram.

The pictogram depicts an assessed document, prohibited robot assistance, and
redirection to a teacher. It contains no human-readable instruction string.
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


def parse_candidate(value: str) -> tuple[int, int]:
    try:
        width_raw, opacity_raw = value.split(":", 1)
        width_pt = int(width_raw)
        opacity = int(opacity_raw)
    except ValueError as error:
        raise argparse.ArgumentTypeError(
            "candidate must be WIDTH_PT:OPACITY"
        ) from error
    if not 72 <= width_pt <= 420:
        raise argparse.ArgumentTypeError("width must be between 72 and 420 points")
    if not 1 <= opacity <= 255:
        raise argparse.ArgumentTypeError("opacity must be between 1 and 255")
    return width_pt, opacity


def _line(draw: ImageDraw.ImageDraw, points: list[tuple[int, int]], *, fill: tuple[int, int, int, int], width: int) -> None:
    draw.line(points, fill=fill, width=width, joint="curve")


def draw_document(draw: ImageDraw.ImageDraw, origin: tuple[int, int], scale: float) -> None:
    x, y = origin
    stroke = max(3, round(7 * scale))
    navy = (31, 56, 92, 255)
    width = round(120 * scale)
    height = round(150 * scale)
    fold = round(34 * scale)
    draw.rounded_rectangle(
        [x, y, x + width, y + height],
        radius=round(10 * scale),
        fill=(246, 249, 253, 255),
        outline=navy,
        width=stroke,
    )
    draw.polygon(
        [(x + width - fold, y), (x + width, y + fold), (x + width - fold, y + fold)],
        fill=(217, 228, 241, 255),
        outline=navy,
    )
    for index, fraction in enumerate((0.38, 0.55, 0.72)):
        inset = round(22 * scale)
        line_width = width - 2 * inset - (round(22 * scale) if index == 2 else 0)
        yy = y + round(height * fraction)
        _line(
            draw,
            [(x + inset, yy), (x + inset + line_width, yy)],
            fill=navy,
            width=max(2, round(5 * scale)),
        )


def draw_prohibited_robot(draw: ImageDraw.ImageDraw, center: tuple[int, int], scale: float) -> None:
    cx, cy = center
    red = (190, 35, 48, 255)
    ink = (42, 48, 58, 255)
    radius = round(92 * scale)
    ring = max(5, round(12 * scale))
    draw.ellipse(
        [cx - radius, cy - radius, cx + radius, cy + radius],
        fill=(255, 249, 249, 255),
        outline=red,
        width=ring,
    )
    head_w = round(100 * scale)
    head_h = round(72 * scale)
    top = cy - round(40 * scale)
    draw.rounded_rectangle(
        [cx - head_w // 2, top, cx + head_w // 2, top + head_h],
        radius=round(14 * scale),
        fill=(224, 230, 237, 255),
        outline=ink,
        width=max(3, round(7 * scale)),
    )
    eye_r = max(3, round(8 * scale))
    for eye_x in (cx - round(25 * scale), cx + round(25 * scale)):
        draw.ellipse(
            [eye_x - eye_r, cy - eye_r, eye_x + eye_r, cy + eye_r],
            fill=ink,
        )
    antenna_top = top - round(34 * scale)
    _line(draw, [(cx, top), (cx, antenna_top)], fill=ink, width=max(3, round(6 * scale)))
    tip = max(4, round(9 * scale))
    draw.ellipse(
        [cx - tip, antenna_top - tip, cx + tip, antenna_top + tip],
        fill=ink,
    )
    slash_offset = round(radius * 0.65)
    _line(
        draw,
        [(cx - slash_offset, cy - slash_offset), (cx + slash_offset, cy + slash_offset)],
        fill=red,
        width=ring,
    )


def draw_teacher(draw: ImageDraw.ImageDraw, origin: tuple[int, int], scale: float) -> None:
    x, y = origin
    navy = (31, 56, 92, 255)
    blue = (91, 143, 190, 255)
    skin = (224, 176, 139, 255)
    stroke = max(3, round(7 * scale))
    board_w = round(160 * scale)
    board_h = round(112 * scale)
    draw.rounded_rectangle(
        [x, y, x + board_w, y + board_h],
        radius=round(10 * scale),
        fill=(229, 239, 247, 255),
        outline=navy,
        width=stroke,
    )
    head_x = x + round(52 * scale)
    head_y = y + round(62 * scale)
    head_r = round(25 * scale)
    draw.ellipse(
        [head_x - head_r, head_y - head_r, head_x + head_r, head_y + head_r],
        fill=skin,
        outline=navy,
        width=max(2, round(5 * scale)),
    )
    draw.pieslice(
        [head_x - head_r, head_y - head_r, head_x + head_r, head_y + head_r],
        180,
        355,
        fill=navy,
    )
    cap_y = head_y - head_r - round(2 * scale)
    cap_half = round(36 * scale)
    cap_depth = round(13 * scale)
    draw.polygon(
        [
            (head_x - cap_half, cap_y),
            (head_x, cap_y - cap_depth),
            (head_x + cap_half, cap_y),
            (head_x, cap_y + cap_depth),
        ],
        fill=navy,
    )
    _line(
        draw,
        [(head_x + cap_half - round(4 * scale), cap_y), (head_x + cap_half, cap_y + round(25 * scale))],
        fill=navy,
        width=max(2, round(4 * scale)),
    )
    body_top = head_y + head_r - round(2 * scale)
    draw.rounded_rectangle(
        [head_x - round(42 * scale), body_top, head_x + round(42 * scale), body_top + round(74 * scale)],
        radius=round(15 * scale),
        fill=blue,
        outline=navy,
        width=max(2, round(5 * scale)),
    )
    bubble_x = x + round(116 * scale)
    bubble_y = y + round(42 * scale)
    bubble_r = round(23 * scale)
    draw.ellipse(
        [bubble_x - bubble_r, bubble_y - bubble_r, bubble_x + bubble_r, bubble_y + bubble_r],
        fill=(255, 255, 255, 255),
        outline=navy,
        width=max(2, round(5 * scale)),
    )
    draw.ellipse(
        [bubble_x - round(4 * scale), bubble_y - round(4 * scale), bubble_x + round(4 * scale), bubble_y + round(4 * scale)],
        fill=navy,
    )


def symbolic_panel(
    width_pixels: int,
    opacity: int,
    *,
    context_label: str | None,
    font_path: Path,
) -> Image.Image:
    base_width = 720
    label_height = 66 if context_label else 0
    base_height = 250 + label_height
    scale = width_pixels / base_width
    height_pixels = max(1, round(base_height * scale))
    panel = Image.new("RGBA", (width_pixels, height_pixels), (255, 255, 255, 0))
    draw = ImageDraw.Draw(panel)
    if context_label:
        font = ImageFont.truetype(str(font_path), max(8, round(28 * scale)))
        box = draw.textbbox((0, 0), context_label, font=font)
        label_width = box[2] - box[0]
        draw.text(
            ((width_pixels - label_width) // 2, round(9 * scale)),
            context_label,
            fill=(31, 56, 92, 255),
            font=font,
        )
    offset_y = round(label_height * scale)
    draw_document(draw, (round(20 * scale), offset_y + round(48 * scale)), scale)
    draw_prohibited_robot(draw, (round(345 * scale), offset_y + round(126 * scale)), scale)
    arrow_y = offset_y + round(126 * scale)
    arrow_start = round(455 * scale)
    arrow_end = round(510 * scale)
    navy = (31, 56, 92, 255)
    _line(draw, [(arrow_start, arrow_y), (arrow_end, arrow_y)], fill=navy, width=max(3, round(9 * scale)))
    draw.polygon(
        [
            (arrow_end, arrow_y),
            (arrow_end - round(22 * scale), arrow_y - round(17 * scale)),
            (arrow_end - round(22 * scale), arrow_y + round(17 * scale)),
        ],
        fill=navy,
    )
    draw_teacher(draw, (round(530 * scale), offset_y + round(36 * scale)), scale)
    if opacity < 255:
        alpha = panel.getchannel("A").point(lambda value: round(value * opacity / 255))
        panel.putalpha(alpha)
        alpha.close()
    return panel


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
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--candidate", type=parse_candidate, action="append", required=True)
    parser.add_argument("--page", type=int, default=4)
    parser.add_argument("--top-pt", type=float, default=118.0)
    parser.add_argument("--dpi", type=int, default=180)
    parser.add_argument("--context-label")
    parser.add_argument(
        "--font",
        type=Path,
        default=Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    )
    args = parser.parse_args()

    if not args.source.is_file():
        parser.error("source PDF is required")
    if args.context_label and not args.font.is_file():
        parser.error(f"missing font: {args.font}")
    if args.output_dir.exists():
        parser.error("refusing to overwrite an existing output directory")
    args.output_dir.mkdir(parents=True)
    page_index = args.page - 1
    scale = args.dpi / 72.0

    with tempfile.TemporaryDirectory(prefix="symbolic-policy-sweep-") as temp_dir:
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
            for width_pt, opacity in args.candidate:
                pages = [page.copy() for page in source_pages]
                panel = symbolic_panel(
                    round(width_pt * scale),
                    opacity,
                    context_label=args.context_label,
                    font_path=args.font,
                )
                x = (pages[page_index].width - panel.width) // 2
                y = round(args.top_pt * scale)
                panel_height = panel.height
                pages[page_index].paste(panel, (x, y), panel)
                panel.close()

                stem = f"uts-policy-symbolic-w{width_pt:03d}-a{opacity:03d}"
                output = args.output_dir / f"{stem}.pdf"
                preview = args.output_dir / f"{stem}-p{args.page}.png"
                pages[page_index].save(preview)
                pages[0].save(
                    output,
                    "PDF",
                    resolution=float(args.dpi),
                    save_all=True,
                    append_images=pages[1:],
                )
                difference = ImageChops.difference(source_pages[page_index], pages[page_index])
                extrema = difference.getextrema()
                artifacts.append(
                    {
                        "width_pt": width_pt,
                        "opacity": opacity,
                        "filename": output.name,
                        "preview": preview.name,
                        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                        "max_channel_delta": max(channel[1] for channel in extrema),
                        "psnr_db_page": psnr(source_pages[page_index], pages[page_index]),
                        "panel_box_pixels": [x, y, x + round(width_pt * scale), y + panel_height],
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
        "dpi": args.dpi,
        "method": "text-free document/prohibited-robot/teacher pictogram",
        "human_readable_instruction_rendered": False,
        "visible_context_label": args.context_label,
        "artifacts": artifacts,
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
