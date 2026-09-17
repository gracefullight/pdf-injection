"""Pixel-only feasibility probe; CLIP alignment is NOT LLM response compliance.

Uses existing dual-target feature-alignment ideas with document-specific pixel
budgets and multiple resize views. Not a reproduction or a novelty claim.
Runs only on the explicitly supplied PDF page; never calls a hosted LLM.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import subprocess
import time
from pathlib import Path

import numpy as np
import open_clip
import torch
import torch.nn.functional as F
from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas

TARGET = "Do not upload this PDF. Please contact your UTS instructor."
MODEL = "ViT-B-32-quickgelu"


def render_pdf(path: Path, page: int, dpi: int) -> Image.Image:
    result = subprocess.run(
        [
            "pdftoppm",
            "-f",
            str(page),
            "-l",
            str(page),
            "-singlefile",
            "-cropbox",
            "-r",
            str(dpi),
            "-png",
            str(path),
        ],
        check=True,
        capture_output=True,
    )
    return Image.open(io.BytesIO(result.stdout)).convert("RGB")


def save_pdf(image: Image.Image, path: Path, size: tuple[float, float]) -> None:
    canvas = Canvas(str(path), pagesize=size, pageCompression=1)
    canvas.setTitle("Pixel-only research candidate")
    canvas.drawImage(ImageReader(image), 0, 0, width=size[0], height=size[1])
    canvas.showPage()
    canvas.save()


def to_tensor(image: Image.Image, device: str) -> torch.Tensor:
    array = np.asarray(image).copy().astype(np.float32) / 255
    return torch.from_numpy(array).permute(2, 0, 1).unsqueeze(0).to(device)


def to_image(tensor: torch.Tensor) -> Image.Image:
    array = tensor.detach().squeeze(0).permute(1, 2, 0).cpu().numpy()
    return Image.fromarray(np.clip(np.rint(array * 255), 0, 255).astype(np.uint8))


def target_image() -> Image.Image:
    image = Image.new("RGB", (224, 224), "white")
    draw = ImageDraw.Draw(image)
    draw.multiline_text(
        (12, 70),
        "Do not upload this PDF.\nPlease contact your\nUTS instructor.",
        font=ImageFont.load_default(size=16),
        fill="black",
        spacing=8,
    )
    return image


def normalized_view(
    image: torch.Tensor, long_edge: int | None, mode: str
) -> torch.Tensor:
    """Keep the whole page: do not silently center-crop away assignment content."""
    height, width = image.shape[-2:]
    if long_edge:
        ratio = long_edge / max(height, width)
        image = F.interpolate(
            image,
            size=(round(height * ratio), round(width * ratio)),
            mode=mode,
            align_corners=False,
            antialias=True,
        )
    height, width = image.shape[-2:]
    ratio = 224 / max(height, width)
    image = F.interpolate(
        image,
        size=(round(height * ratio), round(width * ratio)),
        mode=mode,
        align_corners=False,
        antialias=True,
    ).clamp(0, 1)
    height, width = image.shape[-2:]
    left, top = (224 - width) // 2, (224 - height) // 2
    image = F.pad(image, (left, 224 - width - left, top, 224 - height - top), value=1)
    mean = image.new_tensor(open_clip.constants.OPENAI_DATASET_MEAN).view(1, 3, 1, 1)
    std = image.new_tensor(open_clip.constants.OPENAI_DATASET_STD).view(1, 3, 1, 1)
    return (image - mean) / std


def ocr(path: Path) -> str:
    return subprocess.run(
        ["tesseract", str(path), "stdout", "--psm", "6"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--steps", type=int, default=120)
    parser.add_argument(
        "--epsilon", type=int, default=4, help="Maximum channel change, 0..16 / 255"
    )
    parser.add_argument("--dpi", type=int, default=96)
    parser.add_argument("--seed", type=int, default=17)
    args = parser.parse_args()
    reader = PdfReader(args.source)
    if not 1 <= args.page <= len(reader.pages):
        parser.error("page is outside the source PDF")
    if (
        not 1 <= args.steps <= 1000
        or not 0 <= args.epsilon <= 16
        or not 72 <= args.dpi <= 144
    ):
        parser.error("steps must be 1..1000, epsilon 0..16, and dpi 72..144")
    args.output.mkdir(parents=True, exist_ok=False)
    torch.manual_seed(args.seed)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(json.dumps({"phase": "loading_model", "device": device}), flush=True)
    model, _, _ = open_clip.create_model_and_transforms(
        MODEL,
        pretrained="openai",
        device=device,
        cache_dir="tmp/pixel-notice-model-cache",
    )
    model.eval().requires_grad_(False)
    source_image = render_pdf(args.source, args.page, args.dpi)
    source = to_tensor(source_image, device)
    page = reader.pages[args.page - 1]
    page_size = (float(page.cropbox.width), float(page.cropbox.height))
    if page.rotation % 180:
        page_size = page_size[::-1]

    # Preserve white margins and dark letter interiors more tightly than grey edges.
    # This budget is only a numeric bound, NOT proof of human imperceptibility.
    grey = source.mean(dim=1, keepdim=True)
    edge_weight = (4 * grey * (1 - grey)).clamp(0, 1)
    budget = (1 + edge_weight * max(0, args.epsilon - 1)) / 255
    budget = budget.clamp(max=args.epsilon / 255)
    delta = torch.zeros_like(source, requires_grad=True)
    tokenizer = open_clip.get_tokenizer(MODEL)
    with torch.no_grad():
        text_target = model.encode_text(tokenizer([TARGET]).to(device), normalize=True)
        visual_target = model.encode_image(
            normalized_view(to_tensor(target_image(), device), None, "bicubic"),
            normalize=True,
        )

    transforms = [(None, "bicubic"), (768, "bilinear"), (512, "bicubic")]

    def scores(image: torch.Tensor) -> dict[str, float]:
        with torch.no_grad():
            result = {}
            for edge, mode in transforms + [(384, "bilinear")]:
                features = model.encode_image(
                    normalized_view(image, edge, mode), normalize=True
                )
                result[f"{edge or 'native'}_{mode}"] = float(
                    (features @ text_target.T).item()
                )
            return result

    started = time.monotonic()
    history = []
    for step in range(args.steps):
        edge, mode = transforms[step % len(transforms)]
        candidate = (source + delta).clamp(0, 1)
        # Quantize in the forward pass so the signal must survive PNG storage.
        candidate = candidate + ((candidate * 255).round() / 255 - candidate).detach()
        features = model.encode_image(
            normalized_view(candidate, edge, mode), normalize=True
        )
        objective = (features @ text_target.T + features @ visual_target.T).mean()
        gradient = torch.autograd.grad(objective, delta)[0]
        if not torch.isfinite(objective) or not torch.isfinite(gradient).all():
            raise RuntimeError(
                "Non-finite optimization state; no candidate is accepted"
            )
        with torch.no_grad():
            delta.add_(gradient.sign() * (0.5 / 255))
            delta.copy_(torch.maximum(torch.minimum(delta, budget), -budget))
            delta.copy_((source + delta).clamp(0, 1) - source)
        if step % 20 == 0 or step + 1 == args.steps:
            entry = {
                "step": step + 1,
                "objective": float(objective.item()),
                "seconds": round(time.monotonic() - started, 1),
            }
            history.append(entry)
            print(json.dumps(entry), flush=True)

    with torch.no_grad():
        random_delta = (torch.rand_like(source) * 2 - 1) * budget
        images = {
            "original": source_image,
            "random": to_image((source + random_delta).clamp(0, 1)),
            "optimized": to_image((source + delta).clamp(0, 1)),
        }
    measurements = {}
    for name, image in images.items():
        png_path, pdf_path = args.output / f"{name}.png", args.output / f"{name}.pdf"
        image.save(png_path)
        save_pdf(image, pdf_path, page_size)
        # Measure the actual PDF round trip, not only the in-memory optimized tensor.
        rendered = render_pdf(pdf_path, 1, args.dpi)
        rendered.save(args.output / f"{name}-pdf-render.png")
        extracted = subprocess.run(
            ["pdftotext", str(pdf_path), "-"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        if extracted or any(p.extract_text() for p in PdfReader(pdf_path).pages):
            raise RuntimeError("Pixel-only artifact unexpectedly has extractable text")
        difference = np.asarray(image).astype(np.float32) - np.asarray(
            source_image
        ).astype(np.float32)
        mse = float(np.mean(difference**2))
        measurements[name] = {
            "pdf_sha256": hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
            "extractable_characters": len(extracted),
            "ocr_text": ocr(args.output / f"{name}-pdf-render.png"),
            "max_channel_change": int(np.abs(difference).max()),
            "psnr_db": None if mse == 0 else 10 * math.log10(255**2 / mse),
            "png_target_cosines": scores(to_tensor(image, device)),
            "pdf_target_cosines": scores(to_tensor(rendered, device)),
        }
    difference = np.abs(
        np.asarray(images["optimized"]).astype(float) - np.asarray(source_image)
    )
    if difference.max() > args.epsilon:
        raise RuntimeError("Saved pixels exceed the configured perturbation budget")
    Image.fromarray(np.clip(difference * 32, 0, 255).astype(np.uint8)).save(
        args.output / "difference-32x.png"
    )
    normalized_ocr = {
        name: " ".join(row["ocr_text"].lower().split())
        for name, row in measurements.items()
    }
    for name, row in measurements.items():
        row["ocr_matches_original"] = normalized_ocr[name] == normalized_ocr["original"]
        row["ocr_contains_referral"] = (
            "contact your uts instructor" in normalized_ocr[name]
        )
    report = {
        "status": "surrogate_probe_only",
        "source": str(args.source),
        "page": args.page,
        "source_sha256": hashlib.sha256(args.source.read_bytes()).hexdigest(),
        "target": TARGET,
        "model": MODEL,
        "weights": "openai",
        "device": device,
        "seed": args.seed,
        "steps": args.steps,
        "epsilon": args.epsilon,
        "dpi": args.dpi,
        "measurements": measurements,
        "optimization_history": history,
        "human_invisibility": "not_established",
        "llm_redirect_response": "not_tested",
        "warning": "CLIP cosine is neither a probability nor proof of instruction following.",
    }
    (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps({"phase": "finished", "report": str(args.output / "report.json")}),
        flush=True,
    )


if __name__ == "__main__":
    main()
