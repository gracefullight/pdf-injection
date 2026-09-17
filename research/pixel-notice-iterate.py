"""Bounded multi-step search with actual PDF export/evaluation at each step.

Intermediate loss may worsen; retain the best score separately. Neither a score
nor the exact-target review flag certifies invisibility or a finished product.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from pixel_notice_render import render


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("rendered_reference", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--original", type=Path, required=True)
    parser.add_argument("--page-size-from", type=Path, required=True)
    parser.add_argument("--target-text", required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--export-python", type=Path, required=True)
    parser.add_argument("--iterations", type=int, default=4, choices=range(1, 11))
    parser.add_argument("--content-budget", type=int, default=0, choices=(0, 1))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    scripts = Path(__file__).parent
    source, reference = args.source, args.rendered_reference
    ledger = {
        "status": "search_running_not_product_success",
        "iterations": [],
        "target": args.target_text,
        "original": str(args.original),
        "initial_source": str(source),
        "content_budget": args.content_budget,
        "best_scored_candidate": None,
        "warning": "Manual visual and response review required; one local model and page only.",
    }

    def save():
        (args.output / "ledger.json").write_text(json.dumps(ledger, indent=2) + "\n")

    def run(command, log_path):
        with log_path.open("x") as log:
            subprocess.run(
                [str(p) for p in command],
                stdout=log,
                stderr=subprocess.STDOUT,
                check=True,
            )

    save()
    try:
        for iteration in range(1, args.iterations + 1):
            current = args.output / f"iteration-{iteration:02d}"
            current.mkdir()
            report_path = current / "gradient" / "report.json"
            print(
                json.dumps(
                    {"phase": "gradient", "iteration": iteration, "source": str(source)}
                ),
                flush=True,
            )
            run(
                [
                    sys.executable,
                    scripts / "run-bounded-probe.py",
                    "--seconds",
                    "600",
                    current / "gradient-run",
                    "--",
                    sys.executable,
                    scripts / "pixel-notice-response-gradient.py",
                    source,
                    report_path,
                    "--model",
                    args.model,
                    "--native",
                    "--checkpoint",
                    "--split",
                    "--patch-adjoint",
                    "--attention-adjoint",
                    "--layerwise",
                    "--candidate-step",
                    "--step-sizes",
                    "1",
                    "--bicubic-adjoint",
                    "--rendered-reference",
                    reference,
                    "--budget-reference",
                    args.original,
                    "--content-budget",
                    str(args.content_budget),
                    "--target-text",
                    args.target_text,
                ],
                current / "gradient-wrapper.log",
            )
            report = json.loads(report_path.read_text())
            candidate = report["candidate_steps"][0]
            pdf_dir = current / "pdf"
            run(
                [
                    args.export_python,
                    scripts / "pixel-notice-export.py",
                    args.original,
                    candidate["path"],
                    pdf_dir,
                    "--page-size-from",
                    args.page_size_from,
                ],
                current / "export.log",
            )
            source = Path(candidate["path"])
            reference = pdf_dir / "optimized-pdf-render.png"
            parity = np.array_equal(
                np.asarray(render(Image.open(source).convert("RGB"))),
                np.asarray(Image.open(reference).convert("RGB")),
            )
            export = json.loads((pdf_dir / "export-report.json").read_text())
            metrics = export["measurements"]["optimized"]
            record = {
                "iteration": iteration,
                "candidate": candidate,
                "ordinary_baseline_nll": report["ordinary_forward_baseline_nll"],
                "actual_render_parity": parity,
                "pdf_metrics": metrics,
                "pdf_dir": str(pdf_dir),
            }
            ledger["iterations"].append(record)
            if (
                ledger["best_scored_candidate"] is None
                or candidate["target_nll"]
                < ledger["best_scored_candidate"]["target_nll"]
            ):
                ledger["best_scored_candidate"] = candidate
            save()
            if not parity or not metrics["ocr_matches_original"]:
                ledger["status"] = "stopped_pdf_gate_failed"
                save()
                break
            print(
                json.dumps(
                    {
                        "phase": "actual_response",
                        "iteration": iteration,
                        "target_nll": candidate["target_nll"],
                    }
                ),
                flush=True,
            )
            run(
                [
                    sys.executable,
                    scripts / "run-bounded-probe.py",
                    "--seconds",
                    "300",
                    current / "evaluation-run",
                    "--",
                    sys.executable,
                    scripts / "pixel-notice-evaluate.py",
                    pdf_dir,
                    "--model",
                    args.model,
                ],
                current / "evaluation-wrapper.log",
            )
            evaluation = json.loads((pdf_dir / "local-vlm-responses.json").read_text())
            response = evaluation["responses"]["optimized"]["text"]
            record["actual_response"] = response
            record["exact_target_for_manual_review"] = args.target_text in response
            save()
            print(
                json.dumps(
                    {
                        "phase": "iteration_complete",
                        "iteration": iteration,
                        "target_nll": candidate["target_nll"],
                        "response": response,
                    }
                ),
                flush=True,
            )
            if record["exact_target_for_manual_review"]:
                ledger["status"] = "response_candidate_requires_manual_review"
                save()
                break
        else:
            ledger["status"] = "bounded_search_finished_manual_review_required"
            save()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        ledger["status"] = "search_error"
        ledger["error"] = str(error)
        save()
        raise


if __name__ == "__main__":
    main()
