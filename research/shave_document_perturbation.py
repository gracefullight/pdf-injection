"""Create bounded lower-amplitude variants of a successful document perturbation."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


def scaled_candidate(
    original: np.ndarray, candidate: np.ndarray, epsilon: int
) -> np.ndarray:
    """Scale a saved perturbation to an integer L-infinity pixel budget."""
    if original.shape != candidate.shape or original.ndim != 3:
        raise ValueError("original and candidate must be same-size RGB arrays")
    if epsilon < 0:
        raise ValueError("epsilon must be nonnegative")
    delta = candidate.astype(np.int16) - original.astype(np.int16)
    source_epsilon = int(np.max(np.abs(delta)))
    if source_epsilon == 0:
        if epsilon:
            raise ValueError("cannot scale an unchanged candidate")
        return original.copy()
    if epsilon > source_epsilon:
        raise ValueError("epsilon cannot exceed the saved candidate budget")
    scaled = np.rint(delta.astype(np.float32) * epsilon / source_epsilon)
    return np.clip(original.astype(np.float32) + scaled, 0, 255).astype(np.uint8)


def image_metrics(original: np.ndarray, candidate: np.ndarray) -> dict[str, object]:
    delta = candidate.astype(np.int16) - original.astype(np.int16)
    squared_error = np.mean(delta.astype(np.float64) ** 2)
    return {
        "max_channel_change": int(np.max(np.abs(delta))),
        "changed_channels": int(np.count_nonzero(delta)),
        "mean_absolute_change": float(np.mean(np.abs(delta))),
        "psnr_db": (
            None
            if squared_error == 0
            else float(20 * math.log10(255.0 / math.sqrt(squared_error)))
        ),
    }


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("original", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--epsilon",
        type=int,
        action="append",
        help="Integer channel budget to export; repeat as needed (default: 0..source).",
    )
    args = parser.parse_args()

    if args.output.exists():
        parser.error("refusing to overwrite an existing output directory")
    if not args.original.is_file() or not args.candidate.is_file():
        parser.error("original and candidate images are required")

    original = np.asarray(Image.open(args.original).convert("RGB"))
    candidate = np.asarray(Image.open(args.candidate).convert("RGB"))
    if original.shape != candidate.shape:
        parser.error("original and candidate dimensions must match")
    source_epsilon = int(
        np.max(np.abs(candidate.astype(np.int16) - original.astype(np.int16)))
    )
    if source_epsilon == 0:
        parser.error("candidate does not differ from original")
    epsilons = sorted(set(args.epsilon or range(source_epsilon + 1)))
    if not epsilons or epsilons[0] < 0 or epsilons[-1] > source_epsilon:
        parser.error(f"epsilon values must be between 0 and {source_epsilon}")

    args.output.mkdir(parents=True)
    rows = []
    for epsilon in epsilons:
        scaled = scaled_candidate(original, candidate, epsilon)
        path = args.output / f"epsilon-{epsilon:02d}.png"
        Image.fromarray(scaled).save(path)
        rows.append(
            {
                "requested_epsilon": epsilon,
                "path": str(path),
                "sha256": sha256(path),
                **image_metrics(original, scaled),
            }
        )

    report = {
        "status": "finished",
        "method": "proportional_integer_projection",
        "original": str(args.original),
        "original_sha256": sha256(args.original),
        "source_candidate": str(args.candidate),
        "source_candidate_sha256": sha256(args.candidate),
        "source_epsilon": source_epsilon,
        "variants": rows,
    }
    (args.output / "manifest.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
