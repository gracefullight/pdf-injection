"""Apply one bounded document perturbation to compatible raster bases."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

from shave_document_perturbation import image_metrics


def rebase_candidate(
    reference: np.ndarray, candidate: np.ndarray, base: np.ndarray
) -> np.ndarray:
    """Transfer an exact integer delta without clipping or changing its budget."""
    if reference.shape != candidate.shape or reference.shape != base.shape:
        raise ValueError("reference, candidate, and base must have matching shapes")
    if reference.ndim != 3 or reference.shape[-1] != 3:
        raise ValueError("inputs must be HWC RGB arrays")
    delta = candidate.astype(np.int16) - reference.astype(np.int16)
    rebased = base.astype(np.int16) + delta
    if np.any(rebased < 0) or np.any(rebased > 255):
        raise ValueError("rebasing would clip channels and alter the perturbation")
    return rebased.astype(np.uint8)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--base",
        action="append",
        nargs=2,
        metavar=("LABEL", "PATH"),
        required=True,
    )
    args = parser.parse_args()

    if args.output.exists():
        parser.error("refusing to overwrite an existing output directory")
    if not args.reference.is_file() or not args.candidate.is_file():
        parser.error("reference and candidate images are required")
    if len({label for label, _ in args.base}) != len(args.base):
        parser.error("base labels must be unique")

    reference = np.asarray(Image.open(args.reference).convert("RGB"))
    candidate = np.asarray(Image.open(args.candidate).convert("RGB"))
    source_delta = candidate.astype(np.int16) - reference.astype(np.int16)
    args.output.mkdir(parents=True)

    rows = []
    for label, raw_path in args.base:
        path = Path(raw_path)
        if not path.is_file():
            parser.error(f"missing base image: {path}")
        base = np.asarray(Image.open(path).convert("RGB"))
        rebased = rebase_candidate(reference, candidate, base)
        output_path = args.output / f"{label}.png"
        Image.fromarray(rebased).save(output_path)
        transferred_delta = rebased.astype(np.int16) - base.astype(np.int16)
        if not np.array_equal(source_delta, transferred_delta):
            raise ValueError("saved image did not preserve the exact perturbation")
        rows.append(
            {
                "label": label,
                "base": str(path),
                "base_sha256": sha256(path),
                "image": str(output_path),
                "image_sha256": sha256(output_path),
                **image_metrics(base, rebased),
            }
        )

    manifest = {
        "status": "finished",
        "method": "exact_integer_delta_rebase",
        "reference": str(args.reference),
        "reference_sha256": sha256(args.reference),
        "candidate": str(args.candidate),
        "candidate_sha256": sha256(args.candidate),
        "source_metrics": image_metrics(reference, candidate),
        "conditions": rows,
    }
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest), flush=True)


if __name__ == "__main__":
    main()
