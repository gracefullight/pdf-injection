"""Positive-amplitude sensitivity controls, not imperceptible-PDF deliverables."""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
from pixel_notice_render import render


def scale_positive_pattern(source, one_byte_candidate, amplitude):
    if amplitude not in (1, 2, 4, 8, 16, 32, 64):
        raise ValueError("Use a positive diagnostic amplitude up to 64")
    original = np.asarray(source, dtype=np.int16)
    changed = np.asarray(one_byte_candidate, dtype=np.int16)
    if original.shape != changed.shape or np.max(np.abs(changed - original)) > 1:
        raise ValueError("Expected a same-size one-byte candidate")
    # Positive scaling retains a zero delta at saturated pixels. It does not
    # reconstruct negative/raw gradient directions lost in the saved pattern.
    return Image.fromarray(
        np.clip(original + amplitude * (changed - original), 0, 255).astype(np.uint8)
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("original", type=Path)
    parser.add_argument("one_byte_candidate", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Refusing to overwrite amplitude controls")
    source = Image.open(args.original).convert("RGB")
    pattern = Image.open(args.one_byte_candidate).convert("RGB")
    scale_positive_pattern(source, pattern, 1)
    args.output.mkdir(parents=True)
    report = {
        "status": "amplitude_diagnostic_only",
        "warning": "Higher amplitudes may be visibly textured. No protection or invisibility claim.",
        "source": str(args.original),
        "source_sha256": hashlib.sha256(args.original.read_bytes()).hexdigest(),
        "one_byte_pattern": str(args.one_byte_candidate),
        "pattern_sha256": hashlib.sha256(
            args.one_byte_candidate.read_bytes()
        ).hexdigest(),
        "variants": [],
    }
    render(source).save(args.output / "original-render.png")
    for amplitude in (1, 2, 4, 8, 16, 32, 64):
        candidate = scale_positive_pattern(source, pattern, amplitude)
        candidate_path = args.output / f"amplitude-{amplitude}.png"
        rendered_path = args.output / f"amplitude-{amplitude}-render.png"
        candidate.save(candidate_path)
        render(candidate).save(rendered_path)
        report["variants"].append(
            {
                "amplitude": amplitude,
                "image": str(candidate_path),
                "surrogate_render": str(rendered_path),
            }
        )
    (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
