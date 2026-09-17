"""Transfer a target renderer residual onto an identity-specialized document."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def protected_content_mask(reference: np.ndarray, padding: int) -> np.ndarray:
    ink = (np.min(reference, axis=-1) < 250).astype(np.uint8) * 255
    if padding:
        ink = np.asarray(
            Image.fromarray(ink).filter(ImageFilter.MaxFilter(2 * padding + 1))
        )
    return ink > 0


def residual_transfer(
    anchor: np.ndarray,
    base: np.ndarray,
    rendered_base: np.ndarray,
    rendered_target: np.ndarray,
    *,
    scale: float,
    epsilon_bytes: int,
    protected: np.ndarray,
) -> np.ndarray:
    """Apply a first-order renderer correction with byte and content constraints."""
    if not (
        anchor.shape
        == base.shape
        == rendered_base.shape
        == rendered_target.shape
    ):
        raise ValueError("all RGB image shapes must match")
    if protected.shape != anchor.shape[:2]:
        raise ValueError("protected mask must match image height and width")
    if scale < 0:
        raise ValueError("scale must be non-negative")
    if not 1 <= epsilon_bytes <= 32:
        raise ValueError("epsilon must be within [1, 32]")

    correction = rendered_target.astype(np.float32) - rendered_base.astype(np.float32)
    candidate = np.rint(base.astype(np.float32) + scale * correction)
    lower = np.maximum(0, anchor.astype(np.int16) - epsilon_bytes)
    upper = np.minimum(255, anchor.astype(np.int16) + epsilon_bytes)
    candidate = np.clip(candidate, lower, upper).astype(np.uint8)
    candidate[protected] = base[protected]
    return candidate


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
    parser.add_argument("base", type=Path)
    parser.add_argument("rendered_base", type=Path)
    parser.add_argument("rendered_target", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--scales", default="0.25,0.5,0.75,1,1.25,1.5,2")
    parser.add_argument("--epsilon-bytes", type=int, default=16)
    parser.add_argument("--content-reference", type=Path)
    parser.add_argument("--content-padding", type=int, default=2)
    args = parser.parse_args()

    paths = [args.anchor, args.base, args.rendered_base, args.rendered_target]
    if args.content_reference:
        paths.append(args.content_reference)
    if any(not path.is_file() for path in paths):
        parser.error("all input images must exist")
    if args.output.exists():
        parser.error("refusing to overwrite an existing output directory")
    if not 1 <= args.epsilon_bytes <= 32:
        parser.error("epsilon-bytes must be within [1, 32]")
    if args.content_padding < 0:
        parser.error("content-padding must be non-negative")
    scales = tuple(float(value) for value in args.scales.split(","))
    if any(value < 0 for value in scales):
        parser.error("scales must be non-negative")

    def load(path: Path) -> np.ndarray:
        return np.asarray(Image.open(path).convert("RGB"))

    anchor = load(args.anchor)
    base = load(args.base)
    rendered_base = load(args.rendered_base)
    rendered_target = load(args.rendered_target)
    reference = load(args.content_reference or args.anchor)
    if reference.shape != anchor.shape:
        parser.error("content reference shape must match the anchor")
    protected = protected_content_mask(reference, args.content_padding)

    args.output.mkdir(parents=True)
    manifest = {
        "anchor": str(args.anchor),
        "base": str(args.base),
        "rendered_base": str(args.rendered_base),
        "rendered_target": str(args.rendered_target),
        "epsilon_bytes": args.epsilon_bytes,
        "content_reference": str(args.content_reference or args.anchor),
        "content_padding": args.content_padding,
        "protected_pixels": int(protected.sum()),
        "candidates": [],
    }
    for scale in scales:
        candidate = residual_transfer(
            anchor,
            base,
            rendered_base,
            rendered_target,
            scale=scale,
            epsilon_bytes=args.epsilon_bytes,
            protected=protected,
        )
        label = f"residual-s{scale:g}"
        path = args.output / f"{label}.png"
        Image.fromarray(candidate).save(path)
        manifest["candidates"].append(
            {
                "label": label,
                "path": str(path),
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "changed_protected_channels": int(
                    np.count_nonzero(candidate[protected] != base[protected])
                ),
                **metrics(anchor, candidate),
            }
        )
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
