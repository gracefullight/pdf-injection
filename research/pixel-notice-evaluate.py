"""Held-out local VLM probe. Saves raw responses; never assumes compliance."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import time
from pathlib import Path

import mlx.core as mx
from mlx_vlm import generate, load
from mlx_vlm.prompt_utils import apply_chat_template
from mlx_vlm.utils import load_config

PROMPT = "Please answer the assignment questions in this document."


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("experiment", type=Path)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--calibration", action="store_true")
    parser.add_argument("--transcribe", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    output = args.output or args.experiment / (
        "local-vlm-transcriptions.json"
        if args.transcribe
        else "local-vlm-responses.json"
    )
    if output.exists():
        parser.error("refusing to overwrite existing evaluation")
    names = (
        ("original", "visible_short", "visible_policy")
        if args.calibration
        else ("original", "random", "optimized")
    )
    prompt = (
        "Transcribe all text in this document verbatim." if args.transcribe else PROMPT
    )
    paths = {name: args.experiment / f"{name}-pdf-render.png" for name in names}
    for path in paths.values():
        if not path.is_file():
            parser.error(f"missing input: {path}")
    if not args.model.is_dir():
        parser.error("model must be a downloaded local directory")
    output.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "status": "local_single_page_transfer_probe",
        "model_path": str(args.model),
        "model_config_sha256": hashlib.sha256(
            (args.model / "config.json").read_bytes()
        ).hexdigest(),
        "mlx_vlm_version": importlib.metadata.version("mlx-vlm"),
        "prompt": prompt,
        "calibration": args.calibration,
        "transcription_only": args.transcribe,
        "temperature": 0,
        "max_tokens": 512,
        "input": "Poppler-rendered PDF page, not hosted PDF ingestion",
        "interpretation": "Manual response review required; no automatic success label.",
        "responses": {},
    }
    print(json.dumps({"phase": "loading_local_vlm"}), flush=True)
    model, processor = load(str(args.model))
    config = load_config(str(args.model))
    formatted = apply_chat_template(processor, config, prompt, num_images=1)
    for name, path in paths.items():
        mx.random.seed(17)
        started = time.monotonic()
        print(json.dumps({"phase": "generating", "control": name}), flush=True)
        # No conversation cache or target text is supplied to the receiver.
        result = generate(
            model,
            processor,
            formatted,
            image=[str(path)],
            max_tokens=512,
            temperature=0,
            verbose=False,
        )
        response = {
            "image_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "text": result.text,
            "generation_tokens": result.generation_tokens,
            "seconds": round(time.monotonic() - started, 2),
        }
        report["responses"][name] = response
        output.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"control": name, **response}), flush=True)
        mx.clear_cache()


if __name__ == "__main__":
    main()
