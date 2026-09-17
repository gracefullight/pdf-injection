"""Embed and detect a text-free visual policy watermark in raster PDFs.

The watermark is a keyed, page-dependent spread-spectrum pattern in the blue
channel of near-white pixels. It carries no readable instruction. A local
matched-filter detector maps a positive signature to a trusted policy ID.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageStat
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


@dataclass(frozen=True)
class PageDetection:
    page: int
    score: float
    positive_mean: float
    negative_mean: float
    eligible_positive_pixels: int
    eligible_negative_pixels: int


@dataclass(frozen=True)
class Detection:
    policy_id: str
    score: float
    threshold: float
    detected: bool
    pages: tuple[PageDetection, ...]


def _threshold_mask(channel: Image.Image, threshold: int) -> Image.Image:
    return channel.point(lambda value: 255 if value >= threshold else 0)


def _pattern_mask(
    size: tuple[int, int],
    key: str,
    policy_id: str,
    page_index: int,
    block_pixels: int,
) -> Image.Image:
    width, height = size
    grid_width = math.ceil(width / block_pixels)
    grid_height = math.ceil(height / block_pixels)
    seed = (
        f"pdf-policy-watermark-v1\0{key}\0{policy_id}\0shared-pages\0"
        f"{grid_width}x{grid_height}"
    ).encode()
    random_bytes = hashlib.shake_256(seed).digest(grid_width * grid_height)
    grid = Image.new("L", (grid_width, grid_height))
    grid.putdata([255 if value >= 128 else 0 for value in random_bytes])
    pattern = grid.resize(size, Image.Resampling.NEAREST)
    grid.close()
    return pattern


def embed_page(
    page: Image.Image,
    *,
    key: str,
    policy_id: str,
    page_index: int,
    delta: int,
    block_pixels: int,
    white_threshold: int,
) -> tuple[Image.Image, int]:
    red, green, blue = page.convert("RGB").split()
    eligible = ImageChops.multiply(
        ImageChops.multiply(_threshold_mask(red, white_threshold), _threshold_mask(green, white_threshold)),
        _threshold_mask(blue, white_threshold),
    )
    pattern = _pattern_mask(page.size, key, policy_id, page_index, block_pixels)
    embed_mask = ImageChops.multiply(eligible, pattern)
    amount = embed_mask.point(lambda value: round(value * delta / 255))
    marked_blue = ImageChops.subtract(blue, amount)
    marked = Image.merge("RGB", (red, green, marked_blue))
    changed = ImageStat.Stat(embed_mask).sum[0] // 255
    red.close()
    green.close()
    blue.close()
    eligible.close()
    pattern.close()
    embed_mask.close()
    amount.close()
    marked_blue.close()
    return marked, int(changed)


def detect_page(
    page: Image.Image,
    *,
    key: str,
    policy_id: str,
    page_index: int,
    block_pixels: int,
    white_threshold: int,
) -> PageDetection:
    red, green, blue = page.convert("RGB").split()
    red_white = _threshold_mask(red, white_threshold)
    green_white = _threshold_mask(green, white_threshold)
    eligible = ImageChops.multiply(red_white, green_white)
    pattern = _pattern_mask(page.size, key, policy_id, page_index, block_pixels)
    positive = ImageChops.multiply(eligible, pattern)
    negative = ImageChops.multiply(eligible, ImageChops.invert(pattern))
    rg_mean = Image.blend(red, green, 0.5)
    chroma = ImageChops.subtract(rg_mean, blue)
    positive_stats = ImageStat.Stat(chroma, mask=positive)
    negative_stats = ImageStat.Stat(chroma, mask=negative)
    positive_pixels = int(ImageStat.Stat(positive).sum[0] // 255)
    negative_pixels = int(ImageStat.Stat(negative).sum[0] // 255)
    positive_mean = positive_stats.mean[0] if positive_pixels else 0.0
    negative_mean = negative_stats.mean[0] if negative_pixels else 0.0
    result = PageDetection(
        page=page_index + 1,
        score=positive_mean - negative_mean,
        positive_mean=positive_mean,
        negative_mean=negative_mean,
        eligible_positive_pixels=positive_pixels,
        eligible_negative_pixels=negative_pixels,
    )
    red.close()
    green.close()
    blue.close()
    red_white.close()
    green_white.close()
    eligible.close()
    pattern.close()
    positive.close()
    negative.close()
    rg_mean.close()
    chroma.close()
    return result


def render_pdf(path: Path, dpi: int) -> list[Image.Image]:
    with tempfile.TemporaryDirectory(prefix="policy-watermark-render-") as temp_dir:
        prefix = Path(temp_dir) / "page"
        subprocess.run(
            ["pdftoppm", "-r", str(dpi), str(path), str(prefix)],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        page_paths = sorted(Path(temp_dir).glob("page-*.ppm"))
        if not page_paths:
            raise RuntimeError("pdftoppm produced no pages")
        return [Image.open(page).convert("RGB") for page in page_paths]


def embed_pdf(
    source: Path,
    output: Path,
    *,
    key: str,
    policy_id: str,
    dpi: int = 180,
    delta: int = 8,
    block_pt: float = 4.0,
    white_threshold: int = 245,
) -> dict[str, object]:
    pages = render_pdf(source, dpi)
    block_pixels = max(2, round(block_pt * dpi / 72))
    marked_pages: list[Image.Image] = []
    changed_pixels: list[int] = []
    try:
        for page_index, page in enumerate(pages):
            marked, changed = embed_page(
                page,
                key=key,
                policy_id=policy_id,
                page_index=page_index,
                delta=delta,
                block_pixels=block_pixels,
                white_threshold=white_threshold,
            )
            marked_pages.append(marked)
            changed_pixels.append(changed)
        output.parent.mkdir(parents=True, exist_ok=True)
        first_width = marked_pages[0].width * 72 / dpi
        first_height = marked_pages[0].height * 72 / dpi
        pdf = canvas.Canvas(
            str(output),
            pagesize=(first_width, first_height),
            pageCompression=1,
        )
        pdf.setTitle(output.stem)
        pdf.setCreator("pdf-injection policy-watermark research prototype")
        for page in marked_pages:
            page_width = page.width * 72 / dpi
            page_height = page.height * 72 / dpi
            pdf.setPageSize((page_width, page_height))
            pdf.drawImage(
                ImageReader(page),
                0,
                0,
                width=page_width,
                height=page_height,
                preserveAspectRatio=False,
                mask=None,
            )
            pdf.showPage()
        pdf.save()
    finally:
        for page in pages:
            page.close()
        for page in marked_pages:
            page.close()
    return {
        "source": str(source),
        "output": str(output),
        "policy_id": policy_id,
        "key_sha256": hashlib.sha256(key.encode()).hexdigest(),
        "dpi": dpi,
        "delta": delta,
        "block_pt": block_pt,
        "white_threshold": white_threshold,
        "changed_pixels_by_page": changed_pixels,
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "estimated_max_rec709_luminance_delta": delta * 0.0722,
        "contains_readable_watermark_text": False,
    }


def detect_pdf(
    source: Path,
    *,
    key: str,
    policy_id: str,
    dpi: int = 180,
    block_pt: float = 4.0,
    white_threshold: int = 235,
    threshold: float = 1.5,
) -> Detection:
    pages = render_pdf(source, dpi)
    block_pixels = max(2, round(block_pt * dpi / 72))
    try:
        rows = tuple(
            detect_page(
                page,
                key=key,
                policy_id=policy_id,
                page_index=page_index,
                block_pixels=block_pixels,
                white_threshold=white_threshold,
            )
            for page_index, page in enumerate(pages)
        )
    finally:
        for page in pages:
            page.close()
    weighted_numerator = sum(
        row.score * min(row.eligible_positive_pixels, row.eligible_negative_pixels)
        for row in rows
    )
    weighted_denominator = sum(
        min(row.eligible_positive_pixels, row.eligible_negative_pixels) for row in rows
    )
    score = weighted_numerator / weighted_denominator if weighted_denominator else 0.0
    return Detection(
        policy_id=policy_id,
        score=score,
        threshold=threshold,
        detected=score >= threshold,
        pages=rows,
    )


def _key_from_env(name: str) -> str:
    key = os.environ.get(name)
    if not key:
        raise SystemExit(f"{name} is not set")
    return key


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    embed = subparsers.add_parser("embed")
    embed.add_argument("source", type=Path)
    embed.add_argument("output", type=Path)
    embed.add_argument("--policy-id", default="uts-ai-prohibited-v1")
    embed.add_argument("--key-env", default="PDF_POLICY_WATERMARK_KEY")
    embed.add_argument("--dpi", type=int, default=180)
    embed.add_argument("--delta", type=int, default=8)
    embed.add_argument("--block-pt", type=float, default=4.0)

    detect = subparsers.add_parser("detect")
    detect.add_argument("source", type=Path)
    detect.add_argument("--policy-id", default="uts-ai-prohibited-v1")
    detect.add_argument("--key-env", default="PDF_POLICY_WATERMARK_KEY")
    detect.add_argument("--dpi", type=int, default=180)
    detect.add_argument("--block-pt", type=float, default=4.0)
    detect.add_argument("--threshold", type=float, default=1.5)
    args = parser.parse_args()

    key = _key_from_env(args.key_env)
    if args.command == "embed":
        if args.output.exists():
            parser.error("refusing to overwrite output")
        report = embed_pdf(
            args.source,
            args.output,
            key=key,
            policy_id=args.policy_id,
            dpi=args.dpi,
            delta=args.delta,
            block_pt=args.block_pt,
        )
        report_path = args.output.with_suffix(".watermark.json")
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))
    else:
        result = detect_pdf(
            args.source,
            key=key,
            policy_id=args.policy_id,
            dpi=args.dpi,
            block_pt=args.block_pt,
            threshold=args.threshold,
        )
        print(json.dumps(asdict(result), indent=2))


if __name__ == "__main__":
    main()
