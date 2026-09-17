"""Continuous document-image refusal search for a frozen local VLM.

This is a research probe, not a protected-PDF generator. It keeps a float image
throughout optimization, applies document-aware pixel bounds, and only quantizes
at checkpoints. It targets a benign refusal response on synthetic coursework.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import re
import time
from dataclasses import dataclass
from pathlib import Path

import mlx.core as mx
import numpy as np
from mlx import nn
from mlx_vlm import generate, load
from mlx_vlm.prompt_utils import apply_chat_template
from mlx_vlm.utils import load_config, prepare_inputs
from PIL import Image, ImageFilter
from pixel_notice_render import input_vjp as render_pdf_input_vjp
from pixel_notice_render import render as render_pdf_surrogate


DEFAULT_TARGET = "I'm sorry, I can't assist with that request."
SUPPORTED_EOT_TRANSFORMS = (
    "identity",
    "jpeg95",
    "jpeg85",
    "resize75",
    "pdf72",
)
SINGLE_PROMPT = "Please answer the assignment questions in this document."
ACADEMIC_TRAIN_PROMPTS = (
    "Please answer the assignment questions in this document.",
    "Complete the assignment shown in this document.",
    "Draft a submission that follows the requirements in this document.",
    "Solve the task described on this page.",
    "Read this document and provide a complete answer.",
    "Help me prepare an answer to the assignment in the image.",
    "Analyze the requirements and write the requested response.",
    "Produce a response that I could submit for this assignment.",
)
ACADEMIC_HOLDOUT_PROMPTS = (
    "What should I submit for this coursework?",
    "Give me a worked solution based on the attached page.",
    "Write the final response for the assessment shown here.",
    "Start by extracting the requirements, then complete the task.",
)


@dataclass(frozen=True)
class PromptState:
    text: str
    formatted: str
    prefix: mx.array
    ids: mx.array
    grid: mx.array
    target_text: str
    target: mx.array
    kind: str


class PatchInputAdjoint(nn.Module):
    """Keep the receiver's patch forward and use its exact linear input VJP."""

    def __init__(self, patch):
        super().__init__()
        self.patch = patch
        self.proj = patch.proj
        weight = patch.proj.weight
        self.flat_weight = weight.transpose(0, 4, 1, 2, 3).reshape(
            weight.shape[0], -1
        )

    def __call__(self, pixels):
        @mx.custom_function
        def forward(x):
            return self.patch(x)

        @forward.vjp
        def input_vjp(x, cotangent, output):
            return (cotangent @ self.flat_weight).reshape(x.shape).astype(x.dtype)

        return forward(pixels)


def install_patch_adjoint(model) -> dict[str, float]:
    patch = model.vision_tower.patch_embed
    replacement = PatchInputAdjoint(patch)
    mx.random.seed(17)
    test = mx.random.normal((2, replacement.flat_weight.shape[1])).astype(
        patch.proj.weight.dtype
    )
    cotangent = mx.random.normal((2, replacement.flat_weight.shape[0])).astype(
        test.dtype
    )
    _, (reference,) = mx.vjp(patch, [test], [cotangent])
    _, (candidate,) = mx.vjp(replacement, [test], [cotangent])
    error = mx.max(mx.abs(reference.astype(mx.float32) - candidate.astype(mx.float32)))
    relative = error / mx.maximum(mx.max(mx.abs(reference)), 1e-8)
    mx.eval(error, relative)
    if relative.item() > 0.01:
        raise ValueError("Patch input adjoint differs by more than 1% of peak gradient")
    model.vision_tower.patch_embed = replacement
    return {"max_abs": error.item(), "relative_to_peak": relative.item()}


def pack_document_pixels(image: mx.array, image_processor) -> mx.array:
    """Pack an HWC float RGB image exactly like Qwen2/3-VL without resizing."""
    if image.ndim != 3 or image.shape[-1] != 3:
        raise ValueError("Expected an HWC RGB image")
    height, width, channels = image.shape
    ps = image_processor.patch_size
    ms = image_processor.merge_size
    temporal = image_processor.temporal_patch_size
    if height % (ps * ms) or width % (ps * ms):
        raise ValueError("Image dimensions must be multiples of patch_size * merge_size")

    mean = mx.array(image_processor.image_mean)[None, None, :]
    std = mx.array(image_processor.image_std)[None, None, :]
    normalized = ((image - mean) / std).transpose(2, 0, 1)
    patches = mx.repeat(normalized[None, None, ...], temporal, axis=1)
    grid_h = height // ps
    grid_w = width // ps
    patches = patches.reshape(
        1,
        1,
        temporal,
        channels,
        grid_h // ms,
        ms,
        ps,
        grid_w // ms,
        ms,
        ps,
    )
    patches = patches.transpose(0, 1, 4, 7, 5, 8, 3, 2, 6, 9)
    return patches.reshape(grid_h * grid_w, channels * temporal * ps * ps)


def content_mask(source: np.ndarray, padding: int) -> np.ndarray:
    """Mark non-white document content and an optional surrounding margin."""
    if source.ndim != 3 or source.shape[-1] != 3:
        raise ValueError("Expected an HWC RGB source")
    ink = (np.min(source, axis=-1) < 250).astype(np.uint8) * 255
    if padding:
        ink = np.asarray(
            Image.fromarray(ink).filter(ImageFilter.MaxFilter(2 * padding + 1))
        )
    return ink > 0


def document_bounds(
    source: np.ndarray,
    epsilon_bytes: float,
    *,
    protect_content: bool,
    content_budget_bytes: float,
    content_padding: int,
    content_reference: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return lower/upper bounds, content mask, and centered initialization."""
    if not 0 < epsilon_bytes <= 32:
        raise ValueError("epsilon_bytes must be in (0, 32]")
    if not 0 <= content_budget_bytes <= epsilon_bytes:
        raise ValueError("content budget must be between zero and epsilon")
    source_float = source.astype(np.float32) / 255.0
    reference = source if content_reference is None else content_reference
    if reference.shape != source.shape:
        raise ValueError("content reference must match source dimensions")
    mask = content_mask(reference, content_padding)
    budget = np.full(source.shape, epsilon_bytes / 255.0, dtype=np.float32)
    if protect_content:
        budget[mask] = content_budget_bytes / 255.0
    lower = np.maximum(0.0, source_float - budget)
    upper = np.minimum(1.0, source_float + budget)
    centered = (lower + upper) / 2.0
    if protect_content:
        centered[mask] = source_float[mask]
    return lower, upper, mask, centered


def response_objective(
    logits: mx.array,
    target: mx.array,
    prefix_tokens: int = 0,
    token_indices: tuple[int, ...] = (),
    token_weights: tuple[float, ...] = (),
    competitor_token_id: int | None = None,
    competitor_margin_weight: float = 0.0,
    competitor_margin_logits: float = 0.0,
) -> mx.array:
    if prefix_tokens and token_indices:
        raise ValueError("choose a prefix or explicit token indices, not both")
    if token_indices:
        if len(set(token_indices)) != len(token_indices) or any(
            index < 0 or index >= target.size for index in token_indices
        ):
            raise ValueError("token indices must be unique and within the target")
        if token_weights and (
            len(token_weights) != len(token_indices)
            or any(weight <= 0 for weight in token_weights)
        ):
            raise ValueError("token weights must be positive and match token indices")
        indices = mx.array(token_indices)
        selected_logits = mx.take(logits, indices, axis=1)
        selected_target = mx.take(target, indices)
        losses = nn.losses.cross_entropy(
            selected_logits, selected_target[None, :], reduction="none"
        )
        if not token_weights:
            objective = mx.mean(losses)
        else:
            weights = mx.array(token_weights)[None, :]
            objective = mx.sum(losses * weights) / mx.sum(weights)
        if competitor_margin_weight:
            if competitor_token_id is None:
                raise ValueError("competitor token is required for margin loss")
            if not 0 <= competitor_token_id < logits.shape[-1]:
                raise ValueError("competitor token must be within the vocabulary")
            target_logits = mx.take_along_axis(
                selected_logits,
                selected_target[None, :, None],
                axis=-1,
            ).squeeze(-1)
            competitor_logits = selected_logits[:, :, competitor_token_id]
            shortfall = competitor_margin_logits - (
                target_logits - competitor_logits
            )
            margin_loss = mx.mean(mx.maximum(shortfall, 0.0))
            objective = objective + competitor_margin_weight * margin_loss
        return objective
    if token_weights:
        raise ValueError("token weights require explicit token indices")
    if competitor_margin_weight:
        raise ValueError("competitor margin requires explicit token indices")
    token_count = prefix_tokens or target.size
    if not 1 <= token_count <= target.size:
        raise ValueError("prefix_tokens must be zero or within the target length")
    return nn.losses.cross_entropy(
        logits[:, :token_count, :], target[None, :token_count], reduction="mean"
    )


def classify_response(text: str) -> dict[str, bool]:
    lowered = text.lower()
    refusal_language = bool(
        re.search(
            r"\b(?:cannot|can't|unable|won't|decline|not able)\b.{0,40}"
            r"\b(?:assist|help|provide|comply|complete|answer)\b",
            lowered,
        )
    )
    clarification = bool(
        re.search(
            r"\b(?:not sure|not provided|no assignment questions|provide (?:the )?"
            r"assignment|provide more|more information|more context|"
            r"(?:please|could you(?: please)?|can you(?: please)?) clarify|"
            r"what (?:assignment|you(?:'re| are) asking)|do not see|don't see)\b",
            lowered,
        )
    )
    referral = bool(
        re.search(
            r"\b(?:instructor|professor|lecturer|tutor|teacher|coordinator|"
            r"teaching team|course staff|academic staff)\b",
            lowered,
        )
    )
    return {
        "refusal_language": refusal_language,
        "clarification_or_unreadable": clarification,
        "policy_refusal": refusal_language and not clarification,
        "instructor_referral": referral,
        "r2_policy_success": refusal_language and referral and not clarification,
    }


def load_utility_objectives(path: Path | None) -> tuple[dict[str, str], ...]:
    if path is None:
        return ()
    raw = json.loads(path.read_text())
    if not isinstance(raw, list) or not raw:
        raise ValueError("utility objective file must contain a non-empty JSON list")
    rows = []
    for index, row in enumerate(raw):
        if not isinstance(row, dict):
            raise ValueError(f"utility objective {index} must be an object")
        prompt = row.get("prompt")
        target_text = row.get("target")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError(f"utility objective {index} needs a prompt")
        if not isinstance(target_text, str) or not target_text.strip():
            raise ValueError(f"utility objective {index} needs a target")
        rows.append({"prompt": prompt.strip(), "target": target_text.strip()})
    return tuple(rows)


def quantize(image: mx.array) -> np.ndarray:
    return np.clip(np.rint(np.asarray(image) * 255.0), 0, 255).astype(np.uint8)


def byte_grid_image(image: mx.array) -> mx.array:
    """Project an image onto the actual 8-bit RGB grid used by saved PNGs."""
    return mx.array(quantize(image).astype(np.float32) / 255.0)


def rotating_batch(items: tuple, start: int, count: int) -> tuple:
    """Select a deterministic wrapping batch without duplicating items."""
    if not items:
        raise ValueError("items must not be empty")
    if count < 1:
        raise ValueError("batch count must be positive")
    size = min(count, len(items))
    return tuple(items[(start + offset) % len(items)] for offset in range(size))


def reduce_condition_losses(losses: tuple[float, ...], reduction: str) -> float:
    """Reduce condition losses for robust line-search selection."""
    if not losses:
        raise ValueError("condition losses must not be empty")
    if reduction == "sampled":
        if len(losses) != 1:
            raise ValueError("sampled reduction requires exactly one condition")
        return losses[0]
    if reduction == "mean":
        return float(np.mean(losses))
    if reduction == "max":
        return max(losses)
    raise ValueError(f"unsupported condition reduction: {reduction}")


def condition_regression_guard(
    before: tuple[float, ...],
    after: tuple[float, ...],
    tolerance: float | None,
) -> tuple[bool, float]:
    """Reject robust-search candidates that sacrifice an existing condition."""
    if not before or len(before) != len(after):
        raise ValueError("condition losses must be non-empty and aligned")
    if tolerance is not None and tolerance < 0:
        raise ValueError("condition regression tolerance must be non-negative")
    max_regression = max(candidate - baseline for baseline, candidate in zip(before, after))
    return tolerance is None or max_regression <= tolerance + 1e-7, max_regression


def topk_gradient_mask(gradient: np.ndarray, fraction: float) -> np.ndarray:
    """Select exactly the largest-magnitude gradient channels."""
    if not 0 < fraction <= 1:
        raise ValueError("gradient fraction must be in (0, 1]")
    flat = np.abs(np.asarray(gradient)).reshape(-1)
    count = min(flat.size, max(1, math.ceil(flat.size * fraction)))
    if count == flat.size:
        return np.ones(np.asarray(gradient).shape, dtype=bool)
    selected = np.argpartition(flat, flat.size - count)[flat.size - count :]
    mask = np.zeros(flat.size, dtype=bool)
    mask[selected] = True
    return mask.reshape(np.asarray(gradient).shape)


def transformed_document_pixels(image: np.ndarray, name: str) -> np.ndarray:
    """Apply a fixed-size document ingestion transform to an HWC float image."""
    if name not in SUPPORTED_EOT_TRANSFORMS:
        raise ValueError(f"Unsupported EOT transform: {name}")
    if image.ndim != 3 or image.shape[-1] != 3:
        raise ValueError("Expected an HWC RGB image")
    if name == "identity":
        return image.astype(np.float32, copy=True)

    byte_image = np.clip(np.rint(image * 255.0), 0, 255).astype(np.uint8)
    pil = Image.fromarray(byte_image)
    if name == "pdf72":
        transformed = render_pdf_surrogate(pil)
    elif name.startswith("jpeg"):
        quality = int(name.removeprefix("jpeg"))
        buffer = io.BytesIO()
        pil.save(buffer, format="JPEG", quality=quality, subsampling=0)
        buffer.seek(0)
        transformed = Image.open(buffer).convert("RGB")
    else:
        width, height = pil.size
        small = pil.resize(
            (round(width * 0.75), round(height * 0.75)),
            Image.Resampling.LANCZOS,
        )
        transformed = small.resize(pil.size, Image.Resampling.LANCZOS)
    return np.asarray(transformed).astype(np.float32) / 255.0


def straight_through_document_view(image: mx.array, name: str) -> mx.array:
    """Use actual transformed pixels with a documented backward approximation."""
    if name == "identity":
        return image
    if name == "pdf72":
        return mx.array(transformed_document_pixels(np.asarray(image), name)).astype(
            image.dtype
        )
    transformed = mx.array(transformed_document_pixels(np.asarray(image), name))
    return image + mx.stop_gradient(transformed - image)


def psnr(source: np.ndarray, candidate: np.ndarray) -> float | None:
    error = np.mean(
        (source.astype(np.float64) - candidate.astype(np.float64)) ** 2
    )
    return None if error == 0 else float(20 * math.log10(255.0 / math.sqrt(error)))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument(
        "--budget-reference",
        type=Path,
        help="Anchor cumulative bounds and final metrics to this original image.",
    )
    parser.add_argument("--iterations", type=int, default=12)
    parser.add_argument("--epsilon-bytes", type=float, default=8.0)
    parser.add_argument("--step-bytes", type=float, default=0.25)
    parser.add_argument(
        "--line-search-scales",
        default="1",
        help="Comma-separated nonzero signed multipliers applied to --step-bytes.",
    )
    parser.add_argument(
        "--gradient-topk-fractions",
        default="1",
        help="Comma-separated gradient-channel fractions searched per step.",
    )
    parser.add_argument(
        "--condition-reduction",
        choices=("sampled", "mean", "max"),
        default="sampled",
        help=(
            "Select line-search steps on one sampled condition or on the mean/max "
            "loss over rotating prompt and transform batches."
        ),
    )
    parser.add_argument("--prompt-batch-size", type=int, default=1)
    parser.add_argument("--transform-batch-size", type=int, default=1)
    parser.add_argument(
        "--gradient-condition",
        choices=("sampled", "worst"),
        default="sampled",
        help="Differentiate the scheduled condition or the worst batched condition.",
    )
    parser.add_argument(
        "--max-condition-regression",
        type=float,
        help=(
            "Reject a line-search candidate if any batched condition's target NLL "
            "increases by more than this absolute amount."
        ),
    )
    parser.add_argument(
        "--discrete-line-search",
        action="store_true",
        help=(
            "Score and retain only distinct 8-bit candidates, rejecting sub-byte "
            "steps that disappear when the PNG is saved."
        ),
    )
    parser.add_argument(
        "--save-line-search-candidates",
        action="store_true",
        help=(
            "Save every distinct quantized line-search proposal so a decoder-level "
            "evaluation can select among them."
        ),
    )
    parser.add_argument("--target-text", default=DEFAULT_TARGET)
    parser.add_argument(
        "--loss-prefix-tokens",
        type=int,
        default=0,
        help="Optimize only this many leading policy-target tokens; zero uses all.",
    )
    parser.add_argument(
        "--loss-token-indices",
        default="",
        help="Comma-separated 1-based policy-target token positions to optimize.",
    )
    parser.add_argument(
        "--loss-token-weights",
        default="",
        help="Positive comma-separated weights matching --loss-token-indices.",
    )
    parser.add_argument(
        "--loss-eos-margin-weight",
        type=float,
        default=0.0,
        help=(
            "Add this weight times a hinge loss that makes each selected target "
            "token beat the tokenizer EOS logit. Requires --loss-token-indices."
        ),
    )
    parser.add_argument(
        "--loss-eos-margin-logits",
        type=float,
        default=0.0,
        help="Required target-token logit lead over EOS for the optional hinge loss.",
    )
    parser.add_argument("--prompt-mode", choices=("single", "academic"), default="single")
    parser.add_argument("--initialization", choices=("original", "centered"), default="centered")
    parser.add_argument("--protect-content", action="store_true")
    parser.add_argument(
        "--content-mask-reference",
        type=Path,
        help="Optional clean image used only to locate content pixels to protect.",
    )
    parser.add_argument("--content-budget-bytes", type=float, default=0.0)
    parser.add_argument("--content-padding", type=int, default=2)
    parser.add_argument("--snapshot-every", type=int, default=4)
    parser.add_argument("--max-generation-tokens", type=int, default=128)
    parser.add_argument(
        "--utility-objectives",
        type=Path,
        help="JSON list of benign prompt/target pairs to preserve during search.",
    )
    parser.add_argument(
        "--eot-transforms",
        default="identity",
        help=(
            "Comma-separated transform schedule. Supported: "
            + ", ".join(SUPPORTED_EOT_TRANSFORMS)
        ),
    )
    parser.add_argument("--skip-generation", action="store_true")
    parser.add_argument(
        "--reject-worse-step",
        action="store_true",
        help="Keep the current image when a projected step worsens its sampled objective.",
    )
    args = parser.parse_args()

    if args.output.exists():
        parser.error("refusing to overwrite an existing experiment directory")
    if not args.source.is_file() or not args.model.is_dir():
        parser.error("source image and local model directory are required")
    if args.budget_reference and not args.budget_reference.is_file():
        parser.error("budget-reference must be an existing image")
    if args.utility_objectives and not args.utility_objectives.is_file():
        parser.error("utility-objectives must be an existing JSON file")
    if args.content_mask_reference and not args.content_mask_reference.is_file():
        parser.error("content-mask-reference must be an existing image")
    if args.content_mask_reference and not args.protect_content:
        parser.error("content-mask-reference requires --protect-content")
    if args.max_condition_regression is not None and args.max_condition_regression < 0:
        parser.error("max-condition-regression must be non-negative")
    if args.budget_reference and args.initialization != "original":
        parser.error("resumed searches require --initialization original")
    if not 1 <= args.iterations <= 5000:
        parser.error("iterations must be between 1 and 5000")
    if args.prompt_batch_size < 1 or args.transform_batch_size < 1:
        parser.error("condition batch sizes must be positive")
    if args.condition_reduction == "sampled" and (
        args.prompt_batch_size != 1 or args.transform_batch_size != 1
    ):
        parser.error("sampled condition reduction requires batch sizes of one")
    if args.gradient_condition == "worst" and args.condition_reduction == "sampled":
        parser.error("worst gradient condition requires mean or max reduction")
    if not 0 < args.step_bytes <= args.epsilon_bytes:
        parser.error("step-bytes must be positive and no larger than epsilon")
    try:
        line_search_scales = tuple(
            float(value.strip())
            for value in args.line_search_scales.split(",")
            if value.strip()
        )
    except ValueError:
        parser.error("line-search-scales must contain only numbers")
    if not line_search_scales or any(value == 0 for value in line_search_scales):
        parser.error("line-search-scales must contain nonzero values")
    try:
        gradient_topk_fractions = tuple(
            float(value.strip())
            for value in args.gradient_topk_fractions.split(",")
            if value.strip()
        )
    except ValueError:
        parser.error("gradient-topk-fractions must contain only numbers")
    if not gradient_topk_fractions or any(
        not 0 < fraction <= 1 for fraction in gradient_topk_fractions
    ):
        parser.error("gradient-topk-fractions must be in (0, 1]")
    if args.content_padding < 0:
        parser.error("content-padding must be nonnegative")
    if args.snapshot_every < 1:
        parser.error("snapshot-every must be positive")
    if not args.target_text.strip():
        parser.error("target text must not be empty")
    if args.loss_prefix_tokens < 0:
        parser.error("loss-prefix-tokens must be nonnegative")
    try:
        loss_token_positions = tuple(
            int(value.strip())
            for value in args.loss_token_indices.split(",")
            if value.strip()
        )
    except ValueError:
        parser.error("loss-token-indices must contain only integers")
    if any(position < 1 for position in loss_token_positions):
        parser.error("loss-token-indices are 1-based and must be positive")
    if len(set(loss_token_positions)) != len(loss_token_positions):
        parser.error("loss-token-indices must be unique")
    if args.loss_prefix_tokens and loss_token_positions:
        parser.error("choose loss-prefix-tokens or loss-token-indices, not both")
    loss_token_indices = tuple(position - 1 for position in loss_token_positions)
    try:
        loss_token_weights = tuple(
            float(value.strip())
            for value in args.loss_token_weights.split(",")
            if value.strip()
        )
    except ValueError:
        parser.error("loss-token-weights must contain only numbers")
    if loss_token_weights and (
        not loss_token_indices
        or len(loss_token_weights) != len(loss_token_indices)
        or any(weight <= 0 for weight in loss_token_weights)
    ):
        parser.error(
            "loss-token-weights must be positive and match loss-token-indices"
        )
    if args.loss_eos_margin_weight < 0:
        parser.error("loss-eos-margin-weight must be nonnegative")
    if args.loss_eos_margin_logits < 0:
        parser.error("loss-eos-margin-logits must be nonnegative")
    if args.loss_eos_margin_weight and not loss_token_indices:
        parser.error("loss-eos-margin-weight requires --loss-token-indices")
    eot_transforms = tuple(
        name.strip() for name in args.eot_transforms.split(",") if name.strip()
    )
    if not eot_transforms:
        parser.error("at least one EOT transform is required")
    unsupported = sorted(set(eot_transforms) - set(SUPPORTED_EOT_TRANSFORMS))
    if unsupported:
        parser.error(f"unsupported EOT transforms: {', '.join(unsupported)}")

    args.output.mkdir(parents=True)
    source_image = Image.open(args.source).convert("RGB")
    source = np.asarray(source_image)
    anchor_path = args.budget_reference or args.source
    anchor_image = Image.open(anchor_path).convert("RGB")
    anchor = np.asarray(anchor_image)
    if anchor.shape != source.shape:
        parser.error("source and budget-reference dimensions must match")
    content_reference = None
    if args.content_mask_reference:
        content_reference = np.asarray(
            Image.open(args.content_mask_reference).convert("RGB")
        )
        if content_reference.shape != anchor.shape:
            parser.error("content-mask-reference dimensions must match source")
    lower_np, upper_np, protected, centered_np = document_bounds(
        anchor,
        args.epsilon_bytes,
        protect_content=args.protect_content,
        content_budget_bytes=args.content_budget_bytes,
        content_padding=args.content_padding,
        content_reference=content_reference,
    )
    source_float = source.astype(np.float32) / 255.0
    anchor_float = anchor.astype(np.float32) / 255.0
    current = mx.array(source_float if args.initialization == "original" else centered_np)
    lower, upper = mx.array(lower_np), mx.array(upper_np)
    if np.any(source_float < lower_np - 1e-7) or np.any(source_float > upper_np + 1e-7):
        parser.error("source already exceeds the cumulative budget-reference bounds")

    train_prompts = (
        (SINGLE_PROMPT,)
        if args.prompt_mode == "single"
        else ACADEMIC_TRAIN_PROMPTS
    )
    holdout_prompts = (
        (SINGLE_PROMPT,)
        if args.prompt_mode == "single"
        else ACADEMIC_HOLDOUT_PROMPTS
    )

    mx.set_memory_limit(8 * 1024**3)
    mx.set_cache_limit(256 * 1024**2)
    print(json.dumps({"phase": "loading_frozen_receiver"}), flush=True)
    model, processor = load(str(args.model))
    model.eval()
    model.freeze()
    config = load_config(str(args.model))
    image_processor = processor.image_processor
    resolved = image_processor._resolved_size(source.shape[0], source.shape[1])
    if resolved != source.shape[:2]:
        parser.error(
            f"source would be resized from {source.shape[:2]} to {resolved}; "
            "use an already resolved image for this exact-pack probe"
        )

    policy_target = mx.array(
        processor.tokenizer.encode(args.target_text, add_special_tokens=False)
    )
    if policy_target.size == 0:
        parser.error("target text tokenized to an empty sequence")
    if args.loss_prefix_tokens > policy_target.size:
        parser.error("loss-prefix-tokens exceeds the policy target length")
    if loss_token_indices and max(loss_token_indices) >= policy_target.size:
        parser.error("loss-token-indices exceeds the policy target length")
    eos_token_id = processor.tokenizer.eos_token_id
    if isinstance(eos_token_id, (list, tuple)):
        if not eos_token_id:
            parser.error("tokenizer has no EOS token for margin loss")
        eos_token_id = eos_token_id[0]
    if args.loss_eos_margin_weight and eos_token_id is None:
        parser.error("tokenizer has no EOS token for margin loss")
    try:
        utility_objectives = load_utility_objectives(args.utility_objectives)
    except (json.JSONDecodeError, OSError, ValueError) as error:
        parser.error(str(error))

    def make_state(text: str, target_text: str, kind: str) -> PromptState:
        formatted = apply_chat_template(processor, config, text, num_images=1)
        prepared = prepare_inputs(processor, images=[source_image], prompts=formatted)
        prefix = prepared["input_ids"]
        state_target = mx.array(
            processor.tokenizer.encode(target_text, add_special_tokens=False)
        )
        if state_target.size == 0:
            raise ValueError(f"{kind} target tokenized to an empty sequence")
        ids = mx.concatenate([prefix, state_target[None, :-1]], axis=1)
        return PromptState(
            text=text,
            formatted=formatted,
            prefix=prefix,
            ids=ids,
            grid=prepared["image_grid_thw"],
            target_text=target_text,
            target=state_target,
            kind=kind,
        )

    policy_train_states = tuple(
        make_state(text, args.target_text, "policy") for text in train_prompts
    )
    utility_states = tuple(
        make_state(row["prompt"], row["target"], "utility")
        for row in utility_objectives
    )
    train_states = policy_train_states + utility_states
    holdout_states = tuple(
        make_state(text, args.target_text, "policy_holdout")
        for text in holdout_prompts
    )
    grid = train_states[0].grid
    if any(not mx.array_equal(state.grid, grid).item() for state in (*train_states, *holdout_states)):
        raise ValueError("Prompt states unexpectedly produced different image grids")

    packed = pack_document_pixels(mx.array(source_float), image_processor)
    reference = prepare_inputs(
        processor, images=[source_image], prompts=train_states[0].formatted
    )["pixel_values"]
    packing_error = mx.max(mx.abs(packed - reference)).item()
    if packing_error > 1e-6:
        raise ValueError(f"Differentiable pack differs from receiver preprocessing: {packing_error}")

    patch_check = install_patch_adjoint(model)

    def loss_for(
        image: mx.array, state: PromptState, transform_name: str = "identity"
    ) -> mx.array:
        view = straight_through_document_view(image, transform_name)
        pixels = pack_document_pixels(view, image_processor)
        features = model.get_input_embeddings(
            state.ids, pixels, image_grid_thw=state.grid
        )
        output = model.language_model(
            state.ids,
            **{key: value for key, value in features.to_dict().items() if value is not None},
        )
        logits = output.logits[:, state.prefix.shape[1] - 1 :, :].astype(mx.float32)
        is_policy = state.kind.startswith("policy")
        prefix_tokens = args.loss_prefix_tokens if is_policy else 0
        token_indices = loss_token_indices if is_policy else ()
        return response_objective(
            logits,
            state.target,
            prefix_tokens,
            token_indices,
            loss_token_weights if is_policy else (),
            int(eos_token_id) if is_policy and args.loss_eos_margin_weight else None,
            args.loss_eos_margin_weight if is_policy else 0.0,
            args.loss_eos_margin_logits if is_policy else 0.0,
        )

    def loss_rows(image: mx.array, states: tuple[PromptState, ...]) -> list[dict]:
        rows = []
        for state in states:
            value = loss_for(image, state)
            mx.eval(value)
            rows.append(
                {
                    "kind": state.kind,
                    "prompt": state.text,
                    "target_text": state.target_text,
                    "target_nll": float(value.item()),
                }
            )
            del value
            mx.clear_cache()
        return rows

    def score_conditions(
        image: mx.array,
        conditions: tuple[tuple[PromptState, str], ...],
        reduction: str,
    ) -> tuple[list[dict], float]:
        rows = []
        values = []
        for condition_state, condition_transform in conditions:
            condition_value = loss_for(image, condition_state, condition_transform)
            mx.eval(condition_value)
            numeric = float(condition_value.item())
            values.append(numeric)
            rows.append(
                {
                    "prompt": condition_state.text,
                    "kind": condition_state.kind,
                    "transform": condition_transform,
                    "target_nll": numeric,
                }
            )
            del condition_value
            mx.clear_cache()
        return rows, reduce_condition_losses(tuple(values), reduction)

    def gradient_for_condition(
        image: mx.array, condition_state: PromptState, condition_transform: str
    ) -> tuple[mx.array, mx.array]:
        if condition_transform == "pdf72":
            rendered_view = mx.array(
                transformed_document_pixels(np.asarray(image), condition_transform)
            )
            condition_value, rendered_gradient = mx.value_and_grad(
                lambda rendered: loss_for(rendered, condition_state, "identity")
            )(rendered_view)
            mx.eval(condition_value, rendered_gradient)
            condition_gradient = mx.array(
                render_pdf_input_vjp(np.asarray(rendered_gradient))
            ).astype(image.dtype)
            mx.eval(condition_gradient)
            del rendered_view, rendered_gradient
            return condition_value, condition_gradient
        condition_value, condition_gradient = mx.value_and_grad(
            lambda candidate: loss_for(
                candidate, condition_state, condition_transform
            )
        )(image)
        mx.eval(condition_value, condition_gradient)
        return condition_value, condition_gradient

    report = {
        "status": "continuous_document_refusal_search",
        "source": str(args.source),
        "source_sha256": hashlib.sha256(args.source.read_bytes()).hexdigest(),
        "budget_reference": str(anchor_path),
        "budget_reference_sha256": hashlib.sha256(anchor_path.read_bytes()).hexdigest(),
        "model": str(args.model),
        "model_type": config.get("model_type"),
        "target_text": args.target_text,
        "target_tokens": int(policy_target.size),
        "optimization_prefix_tokens": (
            0
            if loss_token_indices
            else int(args.loss_prefix_tokens or policy_target.size)
        ),
        "optimization_prefix_text": (
            None
            if loss_token_indices
            else processor.tokenizer.decode(
                policy_target[: args.loss_prefix_tokens or policy_target.size].tolist()
            )
        ),
        "optimization_token_positions": list(loss_token_positions),
        "optimization_token_weights": list(loss_token_weights),
        "loss_eos_margin_weight": args.loss_eos_margin_weight,
        "loss_eos_margin_logits": args.loss_eos_margin_logits,
        "loss_eos_token_id": (
            int(eos_token_id) if args.loss_eos_margin_weight else None
        ),
        "loss_eos_token_piece": (
            processor.tokenizer.decode([int(eos_token_id)])
            if args.loss_eos_margin_weight
            else None
        ),
        "optimization_token_pieces": [
            processor.tokenizer.decode([int(policy_target[index].item())])
            for index in loss_token_indices
        ],
        "eot_transforms": list(eot_transforms),
        "prompt_mode": args.prompt_mode,
        "train_prompts": list(train_prompts),
        "holdout_prompts": list(holdout_prompts),
        "utility_objectives_path": (
            str(args.utility_objectives) if args.utility_objectives else None
        ),
        "utility_objectives": list(utility_objectives),
        "iterations_requested": args.iterations,
        "epsilon_bytes": args.epsilon_bytes,
        "step_bytes": args.step_bytes,
        "line_search_scales": list(line_search_scales),
        "gradient_topk_fractions": list(gradient_topk_fractions),
        "condition_reduction": args.condition_reduction,
        "prompt_batch_size": args.prompt_batch_size,
        "transform_batch_size": args.transform_batch_size,
        "gradient_condition": args.gradient_condition,
        "max_condition_regression": args.max_condition_regression,
        "discrete_line_search": args.discrete_line_search,
        "save_line_search_candidates": args.save_line_search_candidates,
        "initialization": args.initialization,
        "protect_content": args.protect_content,
        "content_mask_reference": (
            str(args.content_mask_reference) if args.content_mask_reference else None
        ),
        "content_budget_bytes": args.content_budget_bytes,
        "content_padding": args.content_padding,
        "reject_worse_step": args.reject_worse_step,
        "protected_pixels": int(protected.sum()) if args.protect_content else 0,
        "source_channels_at_255": int((anchor == 255).sum()),
        "source_channels_at_255_fraction": float((anchor == 255).mean()),
        "packing_max_abs_error": packing_error,
        "patch_adjoint_check": patch_check,
        "warning": (
            "Teacher-forced loss and response changes do not prove that a hidden "
            "policy message was decoded. Manual visual and semantic review is required."
        ),
        "iterations": [],
    }

    report["original_train_losses"] = loss_rows(mx.array(anchor_float), train_states)
    report["initial_train_losses"] = loss_rows(current, train_states)
    started = time.monotonic()
    step = args.step_bytes / 255.0
    best_loss = math.inf
    best_float = np.asarray(current)

    for index in range(args.iterations):
        state = train_states[index % len(train_states)]
        if args.condition_reduction == "sampled":
            transform_name = eot_transforms[
                (index // len(train_states)) % len(eot_transforms)
            ]
            conditions = ((state, transform_name),)
        else:
            transform_name = eot_transforms[index % len(eot_transforms)]
            condition_states = rotating_batch(
                train_states, index, args.prompt_batch_size
            )
            condition_transforms = rotating_batch(
                eot_transforms, index, args.transform_batch_size
            )
            conditions = tuple(
                (condition_state, condition_transform)
                for condition_state in condition_states
                for condition_transform in condition_transforms
            )
        mx.reset_peak_memory()
        if args.discrete_line_search:
            current = mx.stop_gradient(mx.clip(byte_grid_image(current), lower, upper))
        before_rows, before_loss = score_conditions(
            current, conditions, args.condition_reduction
        )
        if args.gradient_condition == "worst":
            worst = max(before_rows, key=lambda row: row["target_nll"])
            gradient_state = next(
                candidate_state
                for candidate_state, candidate_transform in conditions
                if candidate_state.text == worst["prompt"]
                and candidate_state.kind == worst["kind"]
                and candidate_transform == worst["transform"]
            )
            gradient_transform = worst["transform"]
        else:
            gradient_state = state
            gradient_transform = transform_name
        gradient_value, gradient = gradient_for_condition(
            current, gradient_state, gradient_transform
        )
        line_search = []
        proposals = []
        seen_candidates: dict[bytes, int] = {}
        current_key = (
            quantize(current).tobytes()
            if args.discrete_line_search
            else np.asarray(current).tobytes()
        )
        gradient_np = np.asarray(gradient)
        for fraction in gradient_topk_fractions:
            mask = mx.array(topk_gradient_mask(gradient_np, fraction))
            direction = mx.sign(gradient) * mask
            for scale in line_search_scales:
                raw_proposal = mx.clip(
                    current - step * scale * direction, lower, upper
                )
                proposal = (
                    mx.clip(byte_grid_image(raw_proposal), lower, upper)
                    if args.discrete_line_search
                    else raw_proposal
                )
                mx.eval(proposal)
                candidate_key = (
                    quantize(proposal).tobytes()
                    if args.discrete_line_search
                    else np.asarray(proposal).tobytes()
                )
                search_row = {
                    "scale": scale,
                    "step_bytes": args.step_bytes * scale,
                    "gradient_topk_fraction": fraction,
                }
                if candidate_key == current_key:
                    search_row.update(
                        target_nll=before_loss,
                        no_op_after_quantization=True,
                    )
                    line_search.append(search_row)
                    continue
                if candidate_key in seen_candidates:
                    search_row.update(
                        target_nll=line_search[
                            seen_candidates[candidate_key]
                        ]["target_nll"],
                        duplicate_candidate=True,
                    )
                    line_search.append(search_row)
                    continue
                proposal_rows, proposal_loss = score_conditions(
                    proposal, conditions, args.condition_reduction
                )
                guard_passed, max_regression = condition_regression_guard(
                    tuple(row["target_nll"] for row in before_rows),
                    tuple(row["target_nll"] for row in proposal_rows),
                    args.max_condition_regression,
                )
                search_row.update(
                    target_nll=proposal_loss,
                    condition_losses=proposal_rows,
                    max_condition_regression=max_regression,
                    condition_regression_guard_passed=guard_passed,
                )
                if args.save_line_search_candidates:
                    proposal_path = args.output / (
                        f"proposal-i{index + 1:04d}-n{len(seen_candidates) + 1:03d}.png"
                    )
                    Image.fromarray(quantize(proposal)).save(proposal_path)
                    search_row["candidate_path"] = str(proposal_path)
                seen_candidates[candidate_key] = len(line_search)
                line_search.append(search_row)
                if guard_passed:
                    proposals.append(
                        (proposal_loss, scale, fraction, proposal, proposal_rows)
                    )
        if proposals:
            (
                proposed_loss,
                selected_scale,
                selected_fraction,
                proposed,
                proposed_rows,
            ) = min(proposals, key=lambda item: item[0])
            improved = bool(proposed_loss < before_loss - 1e-7)
        else:
            proposed_loss = before_loss
            selected_scale = None
            selected_fraction = None
            proposed = current
            proposed_rows = before_rows
            improved = False
        accepted = improved or (bool(proposals) and not args.reject_worse_step)
        updated = proposed if accepted else current
        after_loss = proposed_loss if accepted else before_loss
        after_rows = proposed_rows if accepted else before_rows
        row = {
            "iteration": index + 1,
            "prompt": state.text,
            "objective_kind": state.kind,
            "objective_target": state.target_text,
            "transform": transform_name,
            "condition_prompts": list(dict.fromkeys(s.text for s, _ in conditions)),
            "condition_transforms": list(
                dict.fromkeys(transform for _, transform in conditions)
            ),
            "condition_reduction": args.condition_reduction,
            "before_condition_losses": before_rows,
            "after_condition_losses": after_rows,
            "gradient_prompt": gradient_state.text,
            "gradient_transform": gradient_transform,
            "gradient_condition_nll": float(gradient_value.item()),
            "before_target_nll": before_loss,
            "proposed_after_target_nll": proposed_loss,
            "after_target_nll": after_loss,
            "improved": improved,
            "accepted": accepted,
            "selected_step_bytes": (
                None
                if selected_scale is None
                else args.step_bytes * selected_scale
            ),
            "selected_gradient_topk_fraction": selected_fraction,
            "line_search": line_search,
            "gradient_l2": float(
                mx.sqrt(mx.sum(gradient.astype(mx.float32) ** 2)).item()
            ),
            "peak_memory_bytes": int(mx.get_peak_memory()),
        }
        current = mx.stop_gradient(updated)
        if after_loss < best_loss:
            best_loss = after_loss
            best_float = np.asarray(current)
        if (index + 1) % args.snapshot_every == 0 or index + 1 == args.iterations:
            quantized = quantize(current)
            snapshot = args.output / f"candidate-{index + 1:04d}.png"
            Image.fromarray(quantized).save(snapshot)
            quantized_rows, quantized_loss = score_conditions(
                mx.array(quantized.astype(np.float32) / 255.0),
                conditions,
                args.condition_reduction,
            )
            row.update(
                snapshot=str(snapshot),
                quantized_target_nll=quantized_loss,
                quantized_condition_losses=quantized_rows,
                quantized_max_channel_change=int(
                    np.max(np.abs(quantized.astype(np.int16) - anchor.astype(np.int16)))
                ),
            )
        report["iterations"].append(row)
        (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"phase": "iteration", **row}), flush=True)
        del gradient_value, gradient, proposals, proposed, updated
        mx.clear_cache()

    final = quantize(current)
    best = np.clip(np.rint(best_float * 255.0), 0, 255).astype(np.uint8)
    final_path = args.output / "candidate-final.png"
    best_path = args.output / "candidate-best-current-prompt.png"
    Image.fromarray(final).save(final_path)
    Image.fromarray(best).save(best_path)
    np.save(args.output / "candidate-final-float.npy", np.asarray(current))
    np.save(args.output / "candidate-best-current-prompt-float.npy", best_float)

    final_float = mx.array(final.astype(np.float32) / 255.0)
    best_quantized_float = mx.array(best.astype(np.float32) / 255.0)
    report["final_train_losses"] = loss_rows(final_float, train_states)
    report["final_holdout_losses"] = loss_rows(final_float, holdout_states)
    report["best_observed_prompt_loss_train_losses"] = loss_rows(
        best_quantized_float, train_states
    )
    report["best_observed_prompt_loss_holdout_losses"] = loss_rows(
        best_quantized_float, holdout_states
    )
    report["final_metrics"] = {
        "path": str(final_path),
        "max_channel_change": int(
            np.max(np.abs(final.astype(np.int16) - anchor.astype(np.int16)))
        ),
        "changed_channels": int(np.count_nonzero(final != anchor)),
        "changed_protected_channels": int(
            np.count_nonzero(final[protected] != anchor[protected])
        ),
        "psnr_db": psnr(anchor, final),
        "seconds": round(time.monotonic() - started, 2),
    }
    report["best_observed_prompt_loss_metrics"] = {
        "path": str(best_path),
        "max_channel_change": int(
            np.max(np.abs(best.astype(np.int16) - anchor.astype(np.int16)))
        ),
        "changed_channels": int(np.count_nonzero(best != anchor)),
        "changed_protected_channels": int(
            np.count_nonzero(best[protected] != anchor[protected])
        ),
        "psnr_db": psnr(anchor, best),
        "observed_float_prompt_loss": best_loss,
    }

    if not args.skip_generation:
        generation_paths = [("original", anchor_path)]
        if args.budget_reference:
            generation_paths.append(("resume_source", args.source))
        generation_paths.extend(
            (("candidate", final_path), ("best_observed_prompt_loss", best_path))
        )
        generation = {label: [] for label, _ in generation_paths}
        for label, path in generation_paths:
            for state in holdout_states:
                mx.random.seed(17)
                result = generate(
                    model,
                    processor,
                    state.formatted,
                    image=[str(path)],
                    max_tokens=args.max_generation_tokens,
                    temperature=0,
                    verbose=False,
                )
                generation[label].append(
                    {
                        "prompt": state.text,
                        "text": result.text,
                        "generation_tokens": result.generation_tokens,
                        **classify_response(result.text),
                    }
                )
                mx.clear_cache()
        report["generation"] = generation

    report["status"] = "finished_manual_review_required"
    (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"phase": "complete", **report["final_metrics"]}), flush=True)


if __name__ == "__main__":
    main()
