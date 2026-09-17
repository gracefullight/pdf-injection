"""Create common whole-document transforms from an image-only PDF."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Callable

from PIL import Image, ImageFilter


PageTransform = Callable[[Image.Image], Image.Image]


def jpeg_roundtrip(page: Image.Image, quality: int) -> Image.Image:
    buffer = io.BytesIO()
    page.save(buffer, "JPEG", quality=quality, subsampling=0)
    buffer.seek(0)
    with Image.open(buffer) as decoded:
        return decoded.convert("RGB").copy()


def resize_roundtrip(page: Image.Image, scale: float) -> Image.Image:
    small = page.resize(
        (round(page.width * scale), round(page.height * scale)),
        Image.Resampling.LANCZOS,
    )
    try:
        return small.resize(page.size, Image.Resampling.LANCZOS)
    finally:
        small.close()


def save_image_pdf(pages: list[Image.Image], output: Path, dpi: int) -> None:
    pages[0].save(
        output,
        "PDF",
        resolution=float(dpi),
        save_all=True,
        append_images=pages[1:],
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--dpi", type=int, default=180)
    args = parser.parse_args()

    if not args.source.is_file():
        parser.error(f"missing source: {args.source}")
    if args.output_dir.exists():
        parser.error("refusing to overwrite an existing transform directory")
    if not 72 <= args.dpi <= 600:
        parser.error("dpi must be between 72 and 600")
    args.output_dir.mkdir(parents=True)

    transforms: dict[str, PageTransform] = {
        "reraster": lambda page: page.copy(),
        "jpeg_q95": lambda page: jpeg_roundtrip(page, 95),
        "jpeg_q85": lambda page: jpeg_roundtrip(page, 85),
        "resize_75_roundtrip": lambda page: resize_roundtrip(page, 0.75),
        "blur_0_5": lambda page: page.filter(ImageFilter.GaussianBlur(0.5)),
    }
    rows = []

    with tempfile.TemporaryDirectory(prefix="raster-pdf-transforms-") as temp_dir:
        prefix = Path(temp_dir) / "page"
        subprocess.run(
            [
                "pdftoppm",
                "-r",
                str(args.dpi),
                "-png",
                str(args.source),
                str(prefix),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        page_paths = sorted(Path(temp_dir).glob("page-*.png"))
        if not page_paths:
            raise RuntimeError("pdftoppm produced no pages")
        source_pages = [Image.open(path).convert("RGB") for path in page_paths]
        try:
            for label, transform in transforms.items():
                pages = [transform(page) for page in source_pages]
                output = args.output_dir / f"{label}.pdf"
                try:
                    save_image_pdf(pages, output, args.dpi)
                    cover_extrema = pages[0].getextrema()
                finally:
                    for page in pages:
                        page.close()
                rows.append(
                    {
                        "label": label,
                        "filename": output.name,
                        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                        "cover_min_rgb": min(channel[0] for channel in cover_extrema),
                        "cover_max_rgb": max(channel[1] for channel in cover_extrema),
                    }
                )
        finally:
            for page in source_pages:
                page.close()

    manifest = {
        "source": str(args.source),
        "source_sha256": hashlib.sha256(args.source.read_bytes()).hexdigest(),
        "render_dpi": args.dpi,
        "transforms": rows,
        "warning": "Screening transforms only; test real upload pipelines separately.",
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
