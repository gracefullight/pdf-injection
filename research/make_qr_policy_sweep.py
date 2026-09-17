"""Create raster-only PDFs carrying an assessment policy in a QR symbol.

The policy remains machine-readable without displaying a human-readable
instruction sentence. Candidates vary symbol size, color channel, and module
contrast so the successful Luna boundary can be shaved after screening.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops
from reportlab.graphics.barcode import qr


def parse_candidate(value: str) -> tuple[str, int, int]:
    try:
        mode, size_raw, delta_raw = value.split(":", 2)
        size_pt = int(size_raw)
        delta = int(delta_raw)
    except ValueError as error:
        raise argparse.ArgumentTypeError(
            "candidate must be MODE:SIZE_PT:DELTA"
        ) from error
    if mode not in {"gray", "blue"}:
        raise argparse.ArgumentTypeError("mode must be gray or blue")
    if not 36 <= size_pt <= 240:
        raise argparse.ArgumentTypeError("size must be between 36 and 240 points")
    if not 1 <= delta <= 255:
        raise argparse.ArgumentTypeError("delta must be between 1 and 255")
    return mode, size_pt, delta


def qr_module_mask(payload: str, target_pixels: int, quiet_modules: int = 4) -> tuple[Image.Image, int, int]:
    widget = qr.QrCodeWidget(payload, barLevel="H")
    widget.qr.make()
    modules = widget.qr.modules
    module_count = widget.qr.getModuleCount()
    total_modules = module_count + 2 * quiet_modules
    pixels_per_module = target_pixels // total_modules
    if pixels_per_module < 1:
        raise ValueError(
            f"target size {target_pixels}px is too small for {total_modules} QR modules"
        )

    size = total_modules * pixels_per_module
    mask = Image.new("L", (size, size), 0)
    pixels = mask.load()
    for row, values in enumerate(modules):
        y0 = (row + quiet_modules) * pixels_per_module
        for column, enabled in enumerate(values):
            if not enabled:
                continue
            x0 = (column + quiet_modules) * pixels_per_module
            for y in range(y0, y0 + pixels_per_module):
                for x in range(x0, x0 + pixels_per_module):
                    pixels[x, y] = 255
    return mask, module_count, pixels_per_module


def subtract_carrier(page: Image.Image, mask: Image.Image, position: tuple[int, int], mode: str, delta: int) -> Image.Image:
    full_mask = Image.new("L", page.size, 0)
    full_mask.paste(mask, position)
    amount = full_mask.point(lambda value: round(value * delta / 255))
    red, green, blue = page.convert("RGB").split()
    if mode == "gray":
        red_out = ImageChops.subtract(red, amount)
        green_out = ImageChops.subtract(green, amount)
        blue_out = ImageChops.subtract(blue, amount)
    else:
        red_out = red.copy()
        green_out = green.copy()
        blue_out = ImageChops.subtract(blue, amount)
    output = Image.merge("RGB", (red_out, green_out, blue_out))
    full_mask.close()
    amount.close()
    red.close()
    green.close()
    blue.close()
    red_out.close()
    green_out.close()
    blue_out.close()
    return output


def psnr(reference: Image.Image, candidate: Image.Image) -> float:
    difference = ImageChops.difference(reference, candidate)
    histogram = difference.histogram()
    squared_error = sum(
        (value % 256) ** 2 * count for value, count in enumerate(histogram)
    )
    mse = squared_error / (reference.width * reference.height * 3)
    difference.close()
    return math.inf if mse == 0 else 20 * math.log10(255 / math.sqrt(mse))


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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("payload", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--candidate", type=parse_candidate, action="append", required=True)
    parser.add_argument("--page", type=int, default=4, help="one-based target page")
    parser.add_argument("--top-pt", type=float, default=118.0)
    parser.add_argument("--dpi", type=int, default=180)
    args = parser.parse_args()

    if not args.source.is_file() or not args.payload.is_file():
        parser.error("source PDF and payload text are required")
    if args.output_dir.exists():
        parser.error("refusing to overwrite an existing output directory")
    if not 72 <= args.dpi <= 600:
        parser.error("dpi must be between 72 and 600")
    args.output_dir.mkdir(parents=True)

    payload = " ".join(args.payload.read_text().split())
    page_index = args.page - 1
    scale = args.dpi / 72.0
    with tempfile.TemporaryDirectory(prefix="qr-policy-sweep-") as temp_dir:
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
            for mode, size_pt, delta in args.candidate:
                target_pixels = round(size_pt * scale)
                mask, module_count, pixels_per_module = qr_module_mask(payload, target_pixels)
                x = (source_pages[page_index].width - mask.width) // 2
                y = round(args.top_pt * scale)
                if y + mask.height > source_pages[page_index].height:
                    mask.close()
                    parser.error("QR carrier does not fit on the selected page")

                pages = [page.copy() for page in source_pages]
                protected = subtract_carrier(pages[page_index], mask, (x, y), mode, delta)
                pages[page_index].close()
                pages[page_index] = protected

                stem = f"uts-policy-qr-{mode}-s{size_pt:03d}-d{delta:03d}"
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
                changed = changed_pixel_count(difference)
                extrema = difference.getextrema()
                total = protected.width * protected.height
                artifacts.append(
                    {
                        "mode": mode,
                        "size_pt": size_pt,
                        "delta": delta,
                        "filename": output.name,
                        "preview": preview.name,
                        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                        "max_channel_delta": max(channel[1] for channel in extrema),
                        "changed_pixel_ratio_page": changed / total,
                        "psnr_db_page": psnr(source_pages[page_index], protected),
                        "module_count": module_count,
                        "pixels_per_module": pixels_per_module,
                        "qr_box_pixels": [x, y, x + mask.width, y + mask.height],
                        "page": args.page,
                    }
                )
                difference.close()
                mask.close()
                for page in pages:
                    page.close()
        finally:
            for page in source_pages:
                page.close()

    manifest = {
        "source": str(args.source),
        "payload": str(args.payload),
        "payload_sha256": hashlib.sha256(payload.encode()).hexdigest(),
        "payload_characters": len(payload),
        "dpi": args.dpi,
        "method": "raster QR policy carrier in an existing blank page region",
        "human_readable_instruction_rendered": False,
        "artifacts": artifacts,
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
