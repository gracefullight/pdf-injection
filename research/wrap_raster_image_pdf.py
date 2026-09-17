"""Wrap one raster image as a raster-only PDF and verify its 72-DPI render."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image
from pypdf import PdfReader

from make_factorial_raster_policy_pdf import render_pdf, save_image_pdf


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    if not args.image.is_file():
        parser.error("image is required")
    if args.output.exists():
        parser.error("refusing to overwrite an existing output directory")

    args.output.mkdir(parents=True)
    pdf = args.output / "image-page.pdf"
    render = args.output / "render-72dpi.png"
    image = Image.open(args.image).convert("RGB")
    save_image_pdf(image, pdf)
    render_pdf(pdf, render)
    extracted = (PdfReader(pdf).pages[0].extract_text() or "").strip()
    if extracted:
        raise ValueError("unexpected extractable text in raster-only PDF")

    report = {
        "source": str(args.image),
        "source_sha256": sha256(args.image),
        "size": list(image.size),
        "pdf": str(pdf),
        "pdf_sha256": sha256(pdf),
        "render": str(render),
        "render_sha256": sha256(render),
        "extractable_characters": 0,
    }
    (args.output / "manifest.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
