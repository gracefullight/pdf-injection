"""Export native-size pixel candidates and controls to image-only research PDFs."""

import argparse
import hashlib
import importlib.util
import json
import math
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image


def pixel_metrics(image, baseline):
    if image.size != baseline.size:
        raise ValueError("Pixel metrics require matching dimensions")
    difference = np.asarray(image).astype(np.float32) - np.asarray(baseline).astype(
        np.float32
    )
    mse = float(np.mean(difference**2))
    return {
        "max_channel_change": int(np.abs(difference).max()),
        "changed_channels": int(np.count_nonzero(difference)),
        "psnr_db": None if mse == 0 else 10 * math.log10(255**2 / mse),
    }


def main():
    from pypdf import PdfReader

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--page-size-from", type=Path, required=True)
    args = parser.parse_args()
    baseline = Image.open(args.baseline).convert("RGB")
    candidate = Image.open(args.candidate).convert("RGB")
    if baseline.size != candidate.size:
        parser.error("candidate must retain native baseline dimensions")
    original = np.asarray(baseline).astype(np.int16)
    delta = np.asarray(candidate).astype(np.int16) - original
    if np.abs(delta).max() > 4:
        parser.error("candidate exceeds the experimental 4/255 absolute channel budget")
    page = PdfReader(args.page_size_from).pages[0]
    size = (float(page.mediabox.width), float(page.mediabox.height))
    spec = importlib.util.spec_from_file_location(
        "pixel_probe", Path(__file__).with_name("pixel-notice-probe.py")
    )
    probe = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(probe)
    args.output.mkdir(parents=True, exist_ok=False)
    bound = int(np.abs(delta).max())
    random = np.random.default_rng(17).integers(-bound, bound + 1, original.shape)
    images = {
        "original": baseline,
        "random": Image.fromarray(np.clip(original + random, 0, 255).astype(np.uint8)),
        "optimized": candidate,
    }
    report = {
        "status": "unvalidated_response_candidate",
        "top_level_pixel_metric_domain": "pre_export_images",
        "measurements": {},
    }
    rendered_baseline = None
    for name, image in images.items():
        pdf = args.output / f"{name}.pdf"
        probe.save_pdf(image, pdf, size)
        png = args.output / f"{name}-pdf-render.png"
        rendered = probe.render_pdf(pdf, 1, 96).convert("RGB")
        rendered.save(png)
        if name == "original":
            rendered_baseline = rendered
        text = subprocess.run(
            ["pdftotext", str(pdf), "-"], check=True, capture_output=True, text=True
        ).stdout.strip()
        if text or any(p.extract_text() for p in PdfReader(pdf).pages):
            raise ValueError("Unexpected extractable PDF text")
        report["measurements"][name] = {
            "pdf_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
            "extractable_characters": 0,
            "ocr_text": probe.ocr(png),
            **pixel_metrics(image, baseline),
            "rendered_vs_rendered_original": pixel_metrics(rendered, rendered_baseline),
            "round_trip_vs_own_input": pixel_metrics(rendered, image),
        }
    for measurements in report["measurements"].values():
        measurements["ocr_matches_original"] = (
            measurements["ocr_text"] == report["measurements"]["original"]["ocr_text"]
        )
    (args.output / "export-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
