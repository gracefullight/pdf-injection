"""Rasterize a PDF and rebuild it as an image-only PDF."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--dpi", type=int, default=180)
    args = parser.parse_args()

    if not args.source.is_file():
        parser.error(f"missing source: {args.source}")
    if args.output.exists():
        parser.error("refusing to overwrite output")
    if not 72 <= args.dpi <= 600:
        parser.error("dpi must be between 72 and 600")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="pdf-raster-control-") as temp_dir:
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
        pages = [Image.open(path).convert("RGB") for path in page_paths]
        try:
            pages[0].save(
                args.output,
                "PDF",
                resolution=float(args.dpi),
                save_all=True,
                append_images=pages[1:],
            )
        finally:
            for page in pages:
                page.close()

    report = {
        "source": str(args.source),
        "output": str(args.output),
        "dpi": args.dpi,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
    }
    args.output.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
