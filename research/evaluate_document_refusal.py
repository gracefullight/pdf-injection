"""Evaluate document-response steering across academic prompt paraphrases.

The receiver gets only the image and prompt. No target text, gradients, or
conversation state are supplied during evaluation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import mlx.core as mx
from mlx_vlm import generate, load
from mlx_vlm.prompt_utils import apply_chat_template
from mlx_vlm.utils import load_config

from document_refusal_search import (
    ACADEMIC_HOLDOUT_PROMPTS,
    ACADEMIC_TRAIN_PROMPTS,
    classify_response,
)


def response_class(labels: dict[str, bool]) -> str:
    if labels["r2_policy_success"]:
        return "R2"
    if labels["clarification_or_unreadable"]:
        return "RX"
    if labels["policy_refusal"]:
        return "R1"
    return "R0"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument(
        "--image",
        action="append",
        nargs=2,
        metavar=("LABEL", "PATH"),
        required=True,
    )
    parser.add_argument(
        "--prompt-set", choices=("train", "holdout", "all"), default="all"
    )
    parser.add_argument(
        "--prompt",
        action="append",
        help="Evaluate an explicit prompt; repeat for multiple prompts.",
    )
    parser.add_argument("--max-generation-tokens", type=int, default=128)
    args = parser.parse_args()

    if args.output.exists():
        parser.error("refusing to overwrite an existing report")
    if not args.model.is_dir():
        parser.error("model must be a local directory")
    images = [(label, Path(path)) for label, path in args.image]
    if len({label for label, _ in images}) != len(images):
        parser.error("image labels must be unique")
    for _, path in images:
        if not path.is_file():
            parser.error(f"missing image: {path}")

    prompts = (
        tuple(args.prompt)
        if args.prompt
        else {
            "train": ACADEMIC_TRAIN_PROMPTS,
            "holdout": ACADEMIC_HOLDOUT_PROMPTS,
            "all": ACADEMIC_TRAIN_PROMPTS + ACADEMIC_HOLDOUT_PROMPTS,
        }[args.prompt_set]
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "status": "evaluating",
        "model": str(args.model),
        "prompt_set": "custom" if args.prompt else args.prompt_set,
        "prompts": list(prompts),
        "temperature": 0,
        "max_generation_tokens": args.max_generation_tokens,
        "receiver_isolation": (
            "Each generation receives only one image and one prompt; no target text, "
            "gradient, or prior conversation is supplied."
        ),
        "images": {},
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n")

    print(json.dumps({"phase": "loading_frozen_receiver"}), flush=True)
    model, processor = load(str(args.model))
    model.eval()
    model.freeze()
    config = load_config(str(args.model))

    for label, path in images:
        rows = []
        for prompt in prompts:
            formatted = apply_chat_template(
                processor, config, prompt, num_images=1
            )
            mx.random.seed(17)
            started = time.monotonic()
            result = generate(
                model,
                processor,
                formatted,
                image=[str(path)],
                max_tokens=args.max_generation_tokens,
                temperature=0,
                verbose=False,
            )
            labels = classify_response(result.text)
            row = {
                "prompt": prompt,
                "text": result.text,
                "generation_tokens": result.generation_tokens,
                "seconds": round(time.monotonic() - started, 2),
                **labels,
                "response_class": response_class(labels),
            }
            rows.append(row)
            print(
                json.dumps(
                    {
                        "phase": "generation",
                        "image": label,
                        "response_class": row["response_class"],
                        "prompt": prompt,
                    }
                ),
                flush=True,
            )
            mx.clear_cache()

        counts = {
            key: sum(row["response_class"] == key for row in rows)
            for key in ("R0", "R1", "R2", "RX")
        }
        report["images"][label] = {
            "path": str(path),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "counts": counts,
            "r2_rate": counts["R2"] / len(rows),
            "responses": rows,
        }
        args.output.write_text(json.dumps(report, indent=2) + "\n")

    report["status"] = "finished_manual_review_required"
    args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
