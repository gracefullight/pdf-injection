"""Replay a gradient with a bicubic adjoint and optional content budget; no training."""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

import mlx.core as mx
import numpy as np
from mlx_vlm.utils import load_image_processor, load_processor
from PIL import Image
from pixel_notice_render import render
from pixel_notice_resize import require_bicubic_processor


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gradient_report", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--content-budget", type=int, choices=(0, 1))
    args = parser.parse_args()
    if args.output.exists():
        parser.error("refusing to overwrite replay")
    report = json.loads(args.gradient_report.read_text())
    if not report["calibrated_pdf_forward"] or not report["budget_reference"]:
        parser.error("replay requires a renderer-aware, cumulatively bounded gradient")
    spec = importlib.util.spec_from_file_location(
        "response_gradient",
        Path(__file__).with_name("pixel-notice-response-gradient.py"),
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    image = Image.open(report["source"]).convert("RGB")
    anchor = Image.open(report["budget_reference"]).convert("RGB")
    gradient_path = Path(report["saved_gradient"])
    gradient = mx.array(np.load(gradient_path, allow_pickle=False))
    model_path = Path(report["model"])
    image_processor = load_image_processor(model_path)
    processor = load_processor(model_path)
    if image_processor is not None:
        processor.image_processor = image_processor
    require_bicubic_processor(processor.image_processor)
    mask = module.content_mask(anchor) if report["protected_content_pixels"] else None
    if mask is not None and int(mask.sum()) != report["protected_content_pixels"]:
        raise ValueError("Content mask no longer matches saved report")
    reference = Image.open(report["rendered_reference"]).convert("RGB")
    if not np.array_equal(np.asarray(render(image)), np.asarray(reference)):
        raise ValueError("Baseline render no longer matches saved report")
    records = []
    candidates = []
    for previous in report["candidate_steps"]:
        step = previous["max_channel_change"]
        kwargs = {
            "renderer_adjoint": True,
            "step": step,
            "budget_reference": anchor,
            "protected_mask": mask,
            "protected_budget": report.get("protected_content_budget", 0),
        }
        old = module.pixel_step(
            image,
            gradient,
            mx.array(report["image_grid_thw"]),
            processor,
            bicubic_adjoint=previous["backward_resize"]
            == "pillow_float_bicubic_adjoint_byte_STE",
            **kwargs,
        )
        saved = Image.open(previous["path"]).convert("RGB")
        if not np.array_equal(np.asarray(old), np.asarray(saved)):
            raise ValueError(
                "Saved gradient replay did not reproduce previous candidate"
            )
        if args.content_budget is not None:
            kwargs["protected_budget"] = args.content_budget
        new = module.pixel_step(
            image,
            gradient,
            mx.array(report["image_grid_thw"]),
            processor,
            bicubic_adjoint=True,
            **kwargs,
        )
        path = args.output / f"candidate-step-{step}.png"
        candidates.append((path, new))
        records.append(
            {
                "step": step,
                "path": str(path),
                "previous_replay_identical": True,
                "changed_channels_vs_previous": int(
                    np.count_nonzero(np.asarray(new) != np.asarray(old))
                ),
                "cumulative_max_channel_change": int(
                    np.max(
                        np.abs(
                            np.asarray(new, dtype=np.int16)
                            - np.asarray(anchor, dtype=np.int16)
                        )
                    )
                ),
            }
        )
    args.output.mkdir(parents=True, exist_ok=False)
    for path, candidate in candidates:
        candidate.save(path)
        render(candidate).save(path.with_stem(path.stem + "-render"))
    output = {
        "status": "gradient_replay_diagnostic",
        "content_budget_override": args.content_budget,
        "source_report": str(args.gradient_report),
        "source_report_sha256": hashlib.sha256(
            args.gradient_report.read_bytes()
        ).hexdigest(),
        "gradient_sha256": hashlib.sha256(gradient_path.read_bytes()).hexdigest(),
        "source_sha256": hashlib.sha256(
            Path(report["source"]).read_bytes()
        ).hexdigest(),
        "processor": type(processor.image_processor).__name__,
        "teacher_forced_target": report["teacher_forced_target"],
        "optimization_prefix_tokens": report.get(
            "optimization_prefix_tokens", report["target_tokens"]
        ),
        "warning": "Float interpolation adjoint, not an exact derivative of uint8 clipping/rounding. Actual response and PDF round trip untested.",
        "candidates": records,
    }
    (args.output / "report.json").write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
