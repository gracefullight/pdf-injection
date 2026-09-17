"""Combine faint policy microtext with a transferred text-free perturbation.

The baseline raster PDF supplies the near-background policy. A perturbation
learned on the local Qwen surrogate is resized or tiled onto only near-white
background pixels; document ink and policy glyphs are protected exactly.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


MODES = ("resize-page", "tile-page", "resize-all", "tile-all", "random-all")


def parse_candidate(value: str) -> tuple[str, float]:
    try:
        mode, scale_raw = value.split(":", 1)
        scale = float(scale_raw)
    except ValueError as error:
        raise argparse.ArgumentTypeError("candidate must be MODE:SCALE") from error
    if mode not in MODES:
        raise argparse.ArgumentTypeError(f"mode must be one of {', '.join(MODES)}")
    if not 0 < scale <= 2:
        raise argparse.ArgumentTypeError("scale must be in (0, 2]")
    return mode, scale


def psnr(reference: np.ndarray, candidate: np.ndarray) -> float:
    mse = np.mean(
        (reference.astype(np.float64) - candidate.astype(np.float64)) ** 2
    )
    return math.inf if mse == 0 else 20 * math.log10(255 / math.sqrt(mse))


def resize_delta(delta: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    channels = []
    for channel in range(3):
        source = Image.fromarray(delta[:, :, channel].astype(np.float32), mode="F")
        resized = source.resize(size, Image.Resampling.BILINEAR)
        channels.append(np.asarray(resized, dtype=np.float32))
        source.close()
        resized.close()
    return np.stack(channels, axis=-1)


def tile_delta(delta: np.ndarray, height: int, width: int) -> np.ndarray:
    repeats_y = math.ceil(height / delta.shape[0])
    repeats_x = math.ceil(width / delta.shape[1])
    tiled = np.tile(delta, (repeats_y, repeats_x, 1))
    return tiled[:height, :width].astype(np.float32)


def protected_mask(page: np.ndarray, threshold: int, padding: int) -> np.ndarray:
    ink = (np.min(page, axis=-1) < threshold).astype(np.uint8) * 255
    mask = Image.fromarray(ink)
    if padding:
        expanded = mask.filter(ImageFilter.MaxFilter(2 * padding + 1))
        mask.close()
        mask = expanded
    protected = np.asarray(mask) > 0
    mask.close()
    return protected


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("perturbed_pattern", type=Path)
    parser.add_argument("pattern_anchor", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--candidate", type=parse_candidate, action="append", required=True)
    parser.add_argument("--page", type=int, default=4)
    parser.add_argument("--dpi", type=int, default=300)
    parser.add_argument("--white-threshold", type=int, default=250)
    parser.add_argument("--padding", type=int, default=2)
    parser.add_argument("--seed", type=int, default=17)
    args = parser.parse_args()

    for path in (args.baseline, args.perturbed_pattern, args.pattern_anchor):
        if not path.is_file():
            parser.error(f"missing input: {path}")
    if args.output_dir.exists():
        parser.error("refusing to overwrite an existing output directory")
    if not 1 <= args.white_threshold <= 255:
        parser.error("white threshold must be between 1 and 255")
    args.output_dir.mkdir(parents=True)

    pattern_image = np.asarray(Image.open(args.perturbed_pattern).convert("RGB"), dtype=np.int16)
    anchor_image = np.asarray(Image.open(args.pattern_anchor).convert("RGB"), dtype=np.int16)
    if pattern_image.shape != anchor_image.shape:
        parser.error("pattern and anchor images must have equal dimensions")
    source_delta = (pattern_image - anchor_image).astype(np.float32)
    page_index = args.page - 1

    with tempfile.TemporaryDirectory(prefix="microtext-perturbation-factorial-") as temp_dir:
        prefix = Path(temp_dir) / "page"
        subprocess.run(
            ["pdftoppm", "-r", str(args.dpi), "-png", str(args.baseline), str(prefix)],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        page_paths = sorted(Path(temp_dir).glob("page-*.png"))
        if not 0 <= page_index < len(page_paths):
            parser.error(f"page must be between 1 and {len(page_paths)}")
        baseline_pages = [
            np.asarray(Image.open(path).convert("RGB"), dtype=np.uint8).copy()
            for path in page_paths
        ]
        artifacts: list[dict[str, object]] = []
        rng = np.random.default_rng(args.seed)
        for mode, scale in args.candidate:
            pages = [page.copy() for page in baseline_pages]
            target_pages = range(len(pages)) if mode.endswith("all") else (page_index,)
            protected_channels = 0
            for index in target_pages:
                height, width = pages[index].shape[:2]
                if mode.startswith("resize"):
                    delta = resize_delta(source_delta, (width, height))
                elif mode.startswith("tile"):
                    delta = tile_delta(source_delta, height, width)
                else:
                    epsilon = max(1, round(np.max(np.abs(source_delta))))
                    delta = rng.integers(
                        -epsilon,
                        epsilon + 1,
                        size=pages[index].shape,
                    ).astype(np.float32)
                delta = np.rint(delta * scale).astype(np.int16)
                protected = protected_mask(
                    pages[index], args.white_threshold, args.padding
                )
                protected_channels += int(protected.sum() * 3)
                delta[protected] = 0
                pages[index] = np.clip(
                    pages[index].astype(np.int16) + delta, 0, 255
                ).astype(np.uint8)

            scale_label = str(scale).replace(".", "p")
            stem = f"uts-policy-microtext-perturb-{mode}-x{scale_label}"
            output = args.output_dir / f"{stem}.pdf"
            preview = args.output_dir / f"{stem}-p{args.page}.png"
            images = [Image.fromarray(page) for page in pages]
            images[page_index].save(preview)
            images[0].save(
                output,
                "PDF",
                resolution=float(args.dpi),
                save_all=True,
                append_images=images[1:],
            )
            for image in images:
                image.close()

            changed = np.concatenate(
                [
                    (candidate.astype(np.int16) - baseline.astype(np.int16)).reshape(-1, 3)
                    for baseline, candidate in zip(baseline_pages, pages)
                ],
                axis=0,
            )
            reference = np.concatenate(
                [page.reshape(-1, 3) for page in baseline_pages], axis=0
            )
            candidate_pixels = np.concatenate(
                [page.reshape(-1, 3) for page in pages], axis=0
            )
            artifacts.append(
                {
                    "mode": mode,
                    "scale": scale,
                    "filename": output.name,
                    "preview": preview.name,
                    "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                    "max_abs_perturbation": int(np.max(np.abs(changed))),
                    "changed_channels": int(np.count_nonzero(changed)),
                    "protected_channels": protected_channels,
                    "psnr_db_against_rerendered_baseline": psnr(reference, candidate_pixels),
                    "page": args.page,
                }
            )

    manifest = {
        "baseline": str(args.baseline),
        "perturbed_pattern": str(args.perturbed_pattern),
        "pattern_anchor": str(args.pattern_anchor),
        "pattern_delta_min": int(source_delta.min()),
        "pattern_delta_max": int(source_delta.max()),
        "dpi": args.dpi,
        "white_threshold": args.white_threshold,
        "padding": args.padding,
        "method": "faint microtext plus protected Qwen-surrogate text-free perturbation",
        "artifacts": artifacts,
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
