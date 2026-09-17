"""Create common document-ingestion transforms for robustness screening."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageOps


def file_row(path: Path) -> dict[str, object]:
    row: dict[str, object] = {
        "path": str(path),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }
    if path.suffix.lower() in {".png", ".jpg", ".jpeg"}:
        with Image.open(path) as image:
            row["size"] = list(image.size)
            row["mode"] = image.mode
    return row


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    if not args.source.is_file():
        parser.error("source image is required")
    if args.output.exists():
        parser.error("refusing to overwrite an existing transform directory")
    if not shutil.which("pdftoppm"):
        parser.error("pdftoppm is required for the PDF round-trip")

    args.output.mkdir(parents=True)
    source = Image.open(args.source).convert("RGB")
    width, height = source.size
    outputs: dict[str, Path] = {}

    outputs["identity"] = args.output / "identity.png"
    source.save(outputs["identity"])

    for quality in (95, 85):
        label = f"jpeg_q{quality}"
        outputs[label] = args.output / f"{label}.jpg"
        source.save(outputs[label], quality=quality, subsampling=0)

    small = source.resize(
        (round(width * 0.75), round(height * 0.75)), Image.Resampling.LANCZOS
    )
    outputs["resize_75_roundtrip"] = args.output / "resize-75-roundtrip.png"
    small.resize(source.size, Image.Resampling.LANCZOS).save(
        outputs["resize_75_roundtrip"]
    )

    outputs["blur_0_5"] = args.output / "blur-0.5.png"
    source.filter(ImageFilter.GaussianBlur(0.5)).save(outputs["blur_0_5"])

    outputs["contrast_0_98"] = args.output / "contrast-0.98.png"
    ImageEnhance.Contrast(source).enhance(0.98).save(outputs["contrast_0_98"])

    outputs["invert_rgb"] = args.output / "invert-rgb.png"
    ImageOps.invert(source).save(outputs["invert_rgb"])

    inset = source.resize(
        (round(width * 0.9), round(height * 0.9)), Image.Resampling.LANCZOS
    )
    canvas = Image.new("RGB", source.size, "white")
    canvas.paste(inset, ((width - inset.width) // 2, (height - inset.height) // 2))
    outputs["margin_5_percent"] = args.output / "margin-5-percent.png"
    canvas.save(outputs["margin_5_percent"])

    pdf_path = args.output / "image-page.pdf"
    source.save(pdf_path, "PDF", resolution=72, quality=95)
    pdf_stem = args.output / "pdf-roundtrip-72dpi"
    subprocess.run(
        [
            "pdftoppm",
            "-png",
            "-singlefile",
            "-r",
            "72",
            str(pdf_path),
            str(pdf_stem),
        ],
        check=True,
    )
    outputs["pdf_roundtrip_72dpi"] = pdf_stem.with_suffix(".png")

    manifest = {
        "source": file_row(args.source),
        "transforms": {label: file_row(path) for label, path in outputs.items()},
        "pdf": file_row(pdf_path),
        "warning": (
            "This suite is a small screening set, not a substitute for testing "
            "real PDF renderers, OCR stacks, screenshots, and hosted models."
        ),
    }
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
