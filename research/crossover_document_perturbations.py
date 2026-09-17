"""Cross over two renderer-specialized document perturbations."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


def linear_mix(first: np.ndarray, second: np.ndarray, fraction: float) -> np.ndarray:
    """Interpolate two byte images and return an 8-bit candidate."""
    if first.shape != second.shape:
        raise ValueError("candidate shapes must match")
    if not 0 <= fraction <= 1:
        raise ValueError("fraction must be within [0, 1]")
    mixed = (1 - fraction) * first.astype(np.float32) + fraction * second
    return np.clip(np.rint(mixed), 0, 255).astype(np.uint8)


def crossover(
    first: np.ndarray,
    second: np.ndarray,
    fraction: float,
    *,
    seed: int,
    patch_size: int | None = None,
) -> np.ndarray:
    """Select values from the second candidate by channel or spatial patch."""
    if first.shape != second.shape or first.ndim != 3:
        raise ValueError("candidate RGB shapes must match")
    if not 0 <= fraction <= 1:
        raise ValueError("fraction must be within [0, 1]")
    rng = np.random.default_rng(seed)
    if patch_size is None:
        mask = rng.random(first.shape) < fraction
    else:
        if patch_size < 1:
            raise ValueError("patch size must be positive")
        height, width, _ = first.shape
        rows = math.ceil(height / patch_size)
        columns = math.ceil(width / patch_size)
        patch_mask = rng.random((rows, columns, 1)) < fraction
        mask = np.repeat(np.repeat(patch_mask, patch_size, axis=0), patch_size, axis=1)
        mask = np.broadcast_to(mask[:height, :width], first.shape)
    return np.where(mask, second, first).astype(np.uint8)


def metrics(anchor: np.ndarray, candidate: np.ndarray) -> dict[str, float | int | None]:
    delta = candidate.astype(np.int16) - anchor.astype(np.int16)
    mse = float(np.mean(delta.astype(np.float64) ** 2))
    return {
        "max_channel_change": int(np.max(np.abs(delta))),
        "changed_channels": int(np.count_nonzero(delta)),
        "psnr_db": None if mse == 0 else 20 * math.log10(255 / math.sqrt(mse)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("anchor", type=Path)
    parser.add_argument("first", type=Path)
    parser.add_argument("second", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--fractions", default="0.1,0.25,0.5,0.75,0.9")
    parser.add_argument("--seeds", default="17")
    parser.add_argument("--patch-size", type=int, default=28)
    args = parser.parse_args()

    if args.output.exists():
        parser.error("refusing to overwrite an existing output directory")
    paths = (args.anchor, args.first, args.second)
    if any(not path.is_file() for path in paths):
        parser.error("anchor and both candidates must exist")
    fractions = tuple(float(value) for value in args.fractions.split(","))
    seeds = tuple(int(value) for value in args.seeds.split(","))
    if any(not 0 < value < 1 for value in fractions):
        parser.error("fractions must be within (0, 1)")
    if args.patch_size < 1:
        parser.error("patch-size must be positive")

    anchor = np.asarray(Image.open(args.anchor).convert("RGB"))
    first = np.asarray(Image.open(args.first).convert("RGB"))
    second = np.asarray(Image.open(args.second).convert("RGB"))
    if anchor.shape != first.shape or anchor.shape != second.shape:
        parser.error("all image shapes must match")

    args.output.mkdir(parents=True)
    manifest = {
        "anchor": str(args.anchor),
        "first": str(args.first),
        "second": str(args.second),
        "fractions": list(fractions),
        "seeds": list(seeds),
        "patch_size": args.patch_size,
        "candidates": [],
    }
    rows = []
    for fraction in fractions:
        rows.append((f"linear-f{fraction:g}", linear_mix(first, second, fraction)))
        for seed in seeds:
            rows.append(
                (
                    f"channel-f{fraction:g}-s{seed}",
                    crossover(first, second, fraction, seed=seed),
                )
            )
            rows.append(
                (
                    f"patch{args.patch_size}-f{fraction:g}-s{seed}",
                    crossover(
                        first,
                        second,
                        fraction,
                        seed=seed,
                        patch_size=args.patch_size,
                    ),
                )
            )

    for label, candidate in rows:
        path = args.output / f"{label}.png"
        Image.fromarray(candidate).save(path)
        row = {
            "label": label,
            "path": str(path),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            **metrics(anchor, candidate),
        }
        manifest["candidates"].append(row)

    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
