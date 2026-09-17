"""Create image-only PDF controls with progressively fainter policy-notice pixels."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageStat


def alpha_label(alpha: float) -> str:
    return f"{round(alpha * 1000):04d}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Native PDF with the notice on page one")
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--dpi", type=int, default=180)
    parser.add_argument(
        "--alpha",
        type=float,
        action="append",
        required=True,
        help="Black-text contrast fraction relative to white; repeat for a sweep",
    )
    args = parser.parse_args()

    if not args.source.is_file():
        parser.error(f"missing source: {args.source}")
    if not 72 <= args.dpi <= 600:
        parser.error("dpi must be between 72 and 600")
    if any(not 0 < alpha <= 1 for alpha in args.alpha):
        parser.error("each alpha must be in (0, 1]")
    if len(set(args.alpha)) != len(args.alpha):
        parser.error("alpha values must be unique")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, object] = {
        "source": str(args.source),
        "dpi": args.dpi,
        "method": "page-one RGB values blended toward white; remaining pages unchanged",
        "artifacts": [],
    }

    with tempfile.TemporaryDirectory(prefix="notice-contrast-sweep-") as temp_dir:
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
        original_pages = [Image.open(path).convert("RGB") for path in page_paths]
        original_cover = original_pages[0]
        white_cover = Image.new("RGB", original_cover.size, "white")

        try:
            for alpha in args.alpha:
                cover = Image.blend(white_cover, original_cover, alpha)
                white_delta = ImageChops.difference(cover, white_cover)
                extrema = white_delta.getextrema()
                mean_delta = sum(ImageStat.Stat(white_delta).mean) / 3.0
                white_delta.close()
                pages = [cover, *[page.copy() for page in original_pages[1:]]]
                filename = f"uts-notice-raster-contrast-{alpha_label(alpha)}.pdf"
                output = args.output_dir / filename
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

                manifest["artifacts"].append(
                    {
                        "alpha": alpha,
                        "filename": filename,
                        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                        "cover_min_rgb": 255 - max(channel[1] for channel in extrema),
                        "cover_max_delta_from_white": max(channel[1] for channel in extrema),
                        "cover_mean_delta_from_white": mean_delta,
                    }
                )
        finally:
            white_cover.close()
            for page in original_pages:
                page.close()

    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
