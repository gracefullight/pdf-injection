"""Evaluate policy selectivity for one document with GPT-5.6 Luna."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import time
from datetime import UTC, datetime
from pathlib import Path

from openai_luna_document_eval import (
    classify_response,
    encoded_part,
    output_text,
    request_response,
    response_class,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("document", type=Path)
    parser.add_argument("matrix", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", default="gpt-5.6-luna")
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--max-output-tokens", type=int, default=192)
    parser.add_argument("--api-key-env", default="CHATGPT_API_KEY")
    args = parser.parse_args()

    if not args.document.is_file() or not args.matrix.is_file():
        parser.error("document and matrix files are required")
    if args.output.exists():
        parser.error("refusing to overwrite an existing report")
    api_key = os.environ.get(args.api_key_env)
    if not api_key:
        parser.error(f"{args.api_key_env} is not set")
    prompts = json.loads(args.matrix.read_text())
    if not isinstance(prompts, list) or not prompts:
        parser.error("matrix must be a non-empty JSON array")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    part = encoded_part(args.document, "original")
    report: dict[str, object] = {
        "status": "evaluating",
        "created_at": datetime.now(UTC).isoformat(),
        "model": args.model,
        "document": str(args.document),
        "document_sha256": hashlib.sha256(args.document.read_bytes()).hexdigest(),
        "matrix": str(args.matrix),
        "repeats": args.repeats,
        "store": False,
        "rows": [],
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n")

    for case in prompts:
        case_id = case["id"]
        for repeat in range(1, args.repeats + 1):
            payload = {
                "model": args.model,
                "store": False,
                "reasoning": {"effort": "none"},
                "max_output_tokens": args.max_output_tokens,
                "input": [
                    {
                        "role": "user",
                        "content": [
                            part,
                            {"type": "input_text", "text": case["prompt"]},
                        ],
                    }
                ],
            }
            started = time.monotonic()
            response = request_response(api_key, payload)
            text = output_text(response)
            labels = classify_response(text)
            observed = response_class(labels)
            if case.get("expected"):
                expectation_met = observed == case["expected"]
            else:
                expectation_met = all(
                    re.search(pattern, text, flags=re.IGNORECASE)
                    for pattern in case.get("required_regex", [])
                )
            row = {
                "id": case_id,
                "kind": case["kind"],
                "repeat": repeat,
                "prompt": case["prompt"],
                "expected": case.get("expected"),
                "required_regex": case.get("required_regex"),
                "expectation_met": bool(expectation_met),
                "response_class": observed,
                "text": text,
                "seconds": round(time.monotonic() - started, 2),
                **labels,
            }
            row["strict_expectation_met"] = (
                bool(labels["strict_r2_policy_success"])
                if case["kind"] == "prohibited"
                else bool(expectation_met)
            )
            report["rows"].append(row)
            args.output.write_text(json.dumps(report, indent=2) + "\n")
            print(
                json.dumps(
                    {
                        "id": case_id,
                        "kind": case["kind"],
                        "repeat": repeat,
                        "response_class": observed,
                        "expectation_met": bool(expectation_met),
                    }
                ),
                flush=True,
            )

    rows = report["rows"]
    report["summary"] = {
        kind: {
            "passed": sum(row["expectation_met"] for row in rows if row["kind"] == kind),
            "strict_passed": sum(
                row["strict_expectation_met"] for row in rows if row["kind"] == kind
            ),
            "total": sum(row["kind"] == kind for row in rows),
        }
        for kind in ("prohibited", "benign")
    }
    report["status"] = "finished_manual_review_required"
    args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
