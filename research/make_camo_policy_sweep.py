"""Create PDFs whose policy glyphs are hidden inside a page-wide blue dither."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops

from make_chroma_policy_sweep import render_notice_mask


def tiled_mask(size: tuple[int, int], values: list[int]) -> Image.Image:
    width, height = size
    even_row = bytes((values[0], values[1])) * (width // 2) + bytes((values[0],)) * (width % 2)
    odd_row = bytes((values[2], values[3])) * (width // 2) + bytes((values[2],)) * (width % 2)
    rows = [even_row if y % 2 == 0 else odd_row for y in range(height)]
    return Image.frombytes("L", size, b"".join(rows))


def subtract_blue(page: Image.Image, mask: Image.Image, delta: int) -> Image.Image:
    red, green, blue = page.split()
    amount = mask.point(lambda value: round(value * delta / 255))
    blue = ImageChops.subtract(blue, amount)
    output = Image.merge("RGB", (red, green, blue))
    red.close()
    green.close()
    blue.close()
    amount.close()
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("notice", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--candidate", action="append", required=True, metavar="DELTA:DENSITY")
    parser.add_argument("--page", type=int, default=4)
    parser.add_argument("--top-pt", type=float, default=115.0)
    parser.add_argument("--dpi", type=int, default=180)
    parser.add_argument("--title-pt", type=float, default=24.0)
    parser.add_argument("--body-pt", type=float, default=20.0)
    parser.add_argument("--line-pt", type=float, default=27.0)
    parser.add_argument(
        "--font",
        type=Path,
        default=Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    )
    args = parser.parse_args()

    candidates: list[tuple[int, int]] = []
    for raw in args.candidate:
        try:
            delta_raw, density_raw = raw.split(":", 1)
            delta = int(delta_raw)
            density = int(density_raw)
        except ValueError as error:
            parser.error(f"invalid candidate {raw!r}; expected DELTA:DENSITY")
            raise error
        if not 1 <= delta <= 255 or density not in {75, 100}:
            parser.error("delta must be 1..255 and density must be 75 or 100")
        candidates.append((delta, density))

    if not args.source.is_file() or not args.notice.is_file() or not args.font.is_file():
        parser.error("source, notice, and font must exist")
    if args.output_dir.exists():
        parser.error("refusing to overwrite an existing output directory")
    args.output_dir.mkdir(parents=True)

    notice = args.notice.read_text().strip()
    page_index = args.page - 1
    with tempfile.TemporaryDirectory(prefix="camo-policy-sweep-") as temp_dir:
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
        base_mask = tiled_mask(source_pages[0].size, [255, 0, 0, 255])
        artifacts: list[dict[str, object]] = []
        try:
            for delta, density in candidates:
                pages = [subtract_blue(page, base_mask, delta) for page in source_pages]
                extra_values = [0, 255, 0, 0] if density == 75 else [0, 255, 255, 0]
                extra_pattern = tiled_mask(pages[page_index].size, extra_values)
                glyph_extra = ImageChops.multiply(glyph_mask, extra_pattern)
                protected = subtract_blue(pages[page_index], glyph_extra, delta)
                pages[page_index].close()
                pages[page_index] = protected
                extra_pattern.close()
                glyph_extra.close()

                stem = f"uts-policy-camo-d{delta:03d}-t{density}"
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
                effective = delta * ((density - 50) / 100)
                artifacts.append(
                    {
                        "delta": delta,
                        "background_density_percent": 50,
                        "glyph_density_percent": density,
                        "effective_blue_contrast": effective,
                        "estimated_effective_rec709_luminance_contrast": effective * 0.0722,
                        "filename": output.name,
                        "preview": preview.name,
                        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                        "stamp_box_pixels": stamp_box,
                    }
                )
                for page in pages:
                    page.close()
        finally:
            glyph_mask.close()
            base_mask.close()
            for page in source_pages:
                page.close()

    manifest = {
        "source": str(args.source),
        "notice": str(args.notice),
        "dpi": args.dpi,
        "method": "page-wide 50% blue dither with policy glyphs encoded as a density increase",
        "artifacts": artifacts,
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
