"""Check input gradients of actual target-response likelihood on a frozen VLM.

This small-image capability probe does not generate a protected PDF, prove
invisibility, or demonstrate spontaneous refusal. No model weights are updated.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import mlx.core as mx
import numpy as np
from mlx import nn
from mlx_vlm import load
from mlx_vlm.prompt_utils import apply_chat_template
from mlx_vlm.utils import load_config, prepare_inputs
from PIL import Image, ImageFilter
from pixel_notice_attention import install_attention_adjoint
from pixel_notice_language import language_input_vjp
from pixel_notice_render import input_vjp as render_input_vjp
from pixel_notice_render import render as render_surrogate
from pixel_notice_resize import bicubic_input_vjp, require_bicubic_processor
from pixel_notice_vision import layerwise_vision_vjp

PROMPT = "Please answer the assignment questions in this document."
TARGET = "You should not upload this PDF. Please contact your UTS instructor."


def response_objective(logits, target, prefix_tokens=0):
    """Mean target CE, optionally restricted to an initial optimization prefix."""
    if target.size == 0 or not 0 <= prefix_tokens <= target.size:
        raise ValueError("Prefix length must be zero (full target) or within target")
    count = prefix_tokens or target.size
    return nn.losses.cross_entropy(
        logits[:, :count, :], target[None, :count], reduction="mean"
    )


def scale_saved_pattern(source, candidate, multiplier):
    """Scale an already clipped byte pattern, not the original raw gradient."""
    original = np.asarray(source, dtype=np.int16)
    changed = np.asarray(candidate, dtype=np.int16)
    if original.shape != changed.shape:
        raise ValueError("Pattern and source dimensions must match")
    if abs(multiplier) > 4 or multiplier != int(multiplier):
        raise ValueError("Use integer pattern multipliers between -4 and 4")
    delta = changed - original
    if np.max(np.abs(delta)) > 1:
        raise ValueError("Expected a saved one-byte pattern")
    return Image.fromarray(
        np.clip(original + multiplier * delta, 0, 255).astype(np.uint8)
    )


class CheckpointedBlock(nn.Module):
    """Recompute activations for input gradients; keep the exact existing block."""

    def __init__(self, block):
        super().__init__()
        self.block = block

    @property
    def self_attn(self):
        return self.block.self_attn

    @property
    def is_linear(self):
        return self.block.is_linear

    def __call__(self, *args, **kwargs):
        return mx.checkpoint(self.block)(*args, **kwargs)


def checkpoint_blocks(model, vision=True):
    if vision:
        model.vision_tower.blocks = [
            CheckpointedBlock(block) for block in model.vision_tower.blocks
        ]
    model.language_model.model.layers = [
        CheckpointedBlock(block) for block in model.language_model.model.layers
    ]


class PatchInputAdjoint(nn.Module):
    """Keep Conv3d forward; its non-overlapping, whole-patch input VJP is linear."""

    def __init__(self, patch):
        super().__init__()
        self.patch = patch
        self.proj = patch.proj
        weight = patch.proj.weight
        self.flat_weight = weight.transpose(0, 4, 1, 2, 3).reshape(weight.shape[0], -1)

    def __call__(self, pixels):
        @mx.custom_function
        def forward(x):
            return self.patch(x)

        @forward.vjp
        def input_vjp(x, cotangent, output):
            return (cotangent @ self.flat_weight).reshape(x.shape).astype(x.dtype)

        return forward(pixels)


def install_patch_adjoint(model):
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


def content_mask(image, padding=7):
    """Freeze non-white content plus a conservative pixel neighborhood."""
    ink = (np.min(np.asarray(image), axis=-1) < 250).astype(np.uint8) * 255
    return (
        np.asarray(Image.fromarray(ink).filter(ImageFilter.MaxFilter(2 * padding + 1)))
        > 0
    )


def project_step(
    source,
    direction,
    step,
    budget_reference=None,
    protected_mask=None,
    protected_budget=0,
):
    """Bound each step and, when supplied, total displacement from the original."""
    source = np.asarray(source, dtype=np.float32)
    direction = np.asarray(direction, dtype=np.float32)
    if source.shape != direction.shape or not np.isfinite(direction).all():
        raise ValueError("Expected a finite direction with matching dimensions")
    if step not in (1, 2, 4):
        raise ValueError("Supported experimental byte steps are 1, 2, 4")
    if protected_budget not in (0, 1) or (protected_budget and protected_mask is None):
        raise ValueError("Content budgets must be 0 or 1 and require a content mask")
    updated = source - step * np.sign(direction)
    if budget_reference is not None:
        anchor = np.asarray(budget_reference, dtype=np.float32)
        if anchor.shape != source.shape or np.max(np.abs(source - anchor)) > 4:
            raise ValueError("Source exceeds its same-size 4/255 cumulative budget")
        updated = np.clip(updated, anchor - 4, anchor + 4)
    if protected_mask is not None:
        if budget_reference is None or protected_mask.shape != source.shape[:2]:
            raise ValueError(
                "Content protection requires a same-size reference and mask"
            )
        if np.any(
            np.abs(source[protected_mask] - anchor[protected_mask]) > protected_budget
        ):
            raise ValueError("Starting image exceeds protected content budget")
        updated[protected_mask] = np.clip(
            updated[protected_mask],
            anchor[protected_mask] - protected_budget,
            anchor[protected_mask] + protected_budget,
        )
    return np.clip(updated, 0, 255).astype(np.uint8)


def pixel_step(
    image,
    gradient,
    grid,
    processor,
    *,
    renderer_adjoint=False,
    step=1,
    budget_reference=None,
    protected_mask=None,
    bicubic_adjoint=False,
    protected_budget=0,
):
    """One bounded native-page step; resize backward uses a BPDA approximation."""
    _, height, width = grid[0].tolist()
    ip = processor.image_processor
    ps, ms, temporal = ip.patch_size, ip.merge_size, ip.temporal_patch_size
    # Undo the receiver's spatial patch ordering, then sum duplicated frames.
    packed = np.asarray(gradient.astype(mx.float32))
    unpacked = packed.reshape(
        1, 1, height // ms, width // ms, ms, ms, 3, temporal, ps, ps
    )
    unpacked = unpacked.transpose(0, 1, 7, 6, 2, 4, 8, 3, 5, 9)
    rgb_gradient = unpacked.reshape(temporal, 3, height * ps, width * ps).sum(axis=0)
    rgb_gradient /= np.asarray(ip.image_std, dtype=np.float32)[:, None, None]
    # The real forward uses the unchanged receiver's preprocessing. This resize
    # is an approximate backward pass, not a claim of exact PIL differentiation.
    if bicubic_adjoint:
        require_bicubic_processor(ip)
        native_gradient = bicubic_input_vjp(rgb_gradient.transpose(1, 2, 0), image.size)
    else:
        native_gradient = np.stack(
            [
                np.asarray(
                    Image.fromarray(channel).resize(
                        image.size, Image.Resampling.BILINEAR
                    )
                )
                for channel in rgb_gradient
            ],
            axis=-1,
        )
    if renderer_adjoint:
        native_gradient = render_input_vjp(native_gradient)
    source = np.asarray(image).astype(np.float32)
    candidate = project_step(
        source,
        native_gradient,
        step,
        budget_reference,
        protected_mask,
        protected_budget,
    )
    if np.abs(candidate.astype(np.float32) - source).max() > step:
        raise ValueError("Candidate violates the requested pixel bound")
    return Image.fromarray(candidate)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--checkpoint", action="store_true")
    parser.add_argument("--split", action="store_true")
    parser.add_argument("--patch-adjoint", action="store_true")
    parser.add_argument("--native", action="store_true")
    parser.add_argument("--attention-adjoint", action="store_true")
    parser.add_argument("--candidate-step", action="store_true")
    parser.add_argument("--layerwise", action="store_true")
    parser.add_argument("--rendered-reference", type=Path)
    parser.add_argument("--budget-reference", type=Path)
    parser.add_argument("--protect-content", action="store_true")
    parser.add_argument("--content-budget", type=int, choices=(0, 1))
    parser.add_argument("--bicubic-adjoint", action="store_true")
    parser.add_argument("--reference-ops", action="store_true")
    parser.add_argument("--layerwise-language", action="store_true")
    parser.add_argument(
        "--tensor-line-search",
        action="store_true",
        help=(
            "Score small positive and negative steps directly in the prepared "
            "pixel tensor to distinguish gradient errors from image-space "
            "projection errors."
        ),
    )
    parser.add_argument("--target-text", default=TARGET)
    parser.add_argument("--loss-prefix-tokens", type=int, default=0)
    parser.add_argument(
        "--diagnostic-position",
        type=int,
        action="append",
        default=[],
        help="Report top-5 tokens at this 1-based teacher-forced target position.",
    )
    parser.add_argument(
        "--step-sizes", type=int, nargs="+", choices=(1, 2, 4), default=[1]
    )
    scoring = parser.add_mutually_exclusive_group()
    scoring.add_argument("--score-pattern", type=Path)
    scoring.add_argument("--score-images", type=Path, nargs="+")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("refusing to overwrite a gradient report")
    if args.candidate_step and not args.native:
        parser.error("candidate export requires native source dimensions")
    if args.bicubic_adjoint and not args.candidate_step:
        parser.error("bicubic adjoint requires candidate generation")
    if args.budget_reference and not (args.native and args.candidate_step):
        parser.error("cumulative pixel budgets require native candidate generation")
    if (
        args.protect_content or args.content_budget is not None
    ) and not args.budget_reference:
        parser.error("content protection requires --budget-reference")
    if args.protect_content and args.content_budget is not None:
        parser.error("choose --protect-content or --content-budget, not both")
    if not args.target_text.strip():
        parser.error("target text must not be empty")
    if args.loss_prefix_tokens < 0:
        parser.error("loss prefix must be nonnegative; zero means full target")
    if args.layerwise and not args.split:
        parser.error("layerwise vision requires --split")
    if args.layerwise_language and not (args.split and args.reference_ops):
        parser.error("layerwise language requires --split and --reference-ops")
    if args.rendered_reference and (
        not args.native or args.score_pattern or args.score_images
    ):
        parser.error("render calibration requires native gradient mode")
    if (args.score_pattern or args.score_images) and (
        not args.native
        or any(
            (
                args.checkpoint,
                args.split,
                args.patch_adjoint,
                args.attention_adjoint,
                args.candidate_step,
                args.layerwise,
                args.reference_ops,
                args.layerwise_language,
            )
        )
    ):
        parser.error("forward scoring requires --native and no gradient flags")
    mx.set_memory_limit(8 * 1024**3)
    mx.set_cache_limit(256 * 1024**2)
    print(json.dumps({"phase": "loading_frozen_receiver"}), flush=True)
    model, processor = load(str(args.model))
    model.eval()
    model.freeze()
    config = load_config(str(args.model))
    if args.reference_ops and config.get("model_type") != "qwen3_5":
        parser.error("reference ops are inspected only for Qwen3.5")
    prompt = apply_chat_template(processor, config, PROMPT, num_images=1)
    image = Image.open(args.image).convert("RGB")
    if not args.native:
        image = image.resize((224, 280), Image.Resampling.BICUBIC)
    budget_reference = None
    protected_mask = None
    if args.budget_reference:
        budget_reference = Image.open(args.budget_reference).convert("RGB")
        protected_mask = (
            content_mask(budget_reference)
            if args.protect_content or args.content_budget is not None
            else None
        )
        project_step(
            image,
            np.zeros_like(np.asarray(image)),
            1,
            budget_reference,
            protected_mask,
            args.content_budget or 0,
        )
    receiver_image = image
    if args.rendered_reference:
        if image.size != (816, 1056):
            parser.error("The calibrated renderer is only validated at 816x1056")
        receiver_image = render_surrogate(image)
        reference = Image.open(args.rendered_reference).convert("RGB")
        if not np.array_equal(np.asarray(receiver_image), np.asarray(reference)):
            parser.error("Calibrated renderer does not match the actual PDF reference")
    prepared = prepare_inputs(processor, images=[receiver_image], prompts=prompt)
    prefix = prepared["input_ids"]
    target = mx.array(
        processor.tokenizer.encode(args.target_text, add_special_tokens=False)
    )
    if target.size == 0 or args.loss_prefix_tokens > target.size:
        parser.error("loss prefix exceeds the nonempty tokenized target")
    if any(position < 1 or position > target.size for position in args.diagnostic_position):
        parser.error("diagnostic-position must be within the tokenized target")
    ids = mx.concatenate([prefix, target[None, :-1]], axis=1)
    pixels = prepared["pixel_values"]
    grid = prepared["image_grid_thw"]
    report = {
        "status": "gradient_capability_only",
        "model": str(args.model),
        "source": str(args.image),
        "probe_size": list(image.size),
        "native_source_size": args.native,
        "prompt": PROMPT,
        "teacher_forced_target": args.target_text,
        "pixel_tensor_shape": list(pixels.shape),
        "image_grid_thw": grid.tolist(),
        "target_tokens": target.size,
        "optimization_prefix_tokens": args.loss_prefix_tokens or target.size,
        "optimization_prefix_text": processor.tokenizer.decode(
            target[: args.loss_prefix_tokens or target.size].tolist()
        ),
        "checkpoint_blocks": args.checkpoint,
        "split_vision_language_backward": args.split,
        "patch_input_adjoint": args.patch_adjoint,
        "attention_input_adjoint": args.attention_adjoint,
        "layerwise_vision_adjoint": args.layerwise,
        "rendered_reference": str(args.rendered_reference)
        if args.rendered_reference
        else None,
        "calibrated_pdf_forward": bool(args.rendered_reference),
        "protected_content_pixels": int(protected_mask.sum())
        if protected_mask is not None
        else 0,
        "protected_content_budget": args.content_budget or 0,
        "budget_reference": str(args.budget_reference)
        if args.budget_reference
        else None,
        "warning": "Teacher-forced likelihood is not a generated response.",
        "reference_ops_backward": args.reference_ops,
        "layerwise_language_backward": args.layerwise_language,
    }

    def loss(pixel_values, cached=None, *, return_logits=False):
        features = model.get_input_embeddings(
            ids, pixel_values, image_grid_thw=grid, cached_image_features=cached
        )
        output = model.language_model(
            ids,
            **{k: v for k, v in features.to_dict().items() if v is not None},
        )
        logits = output.logits[:, prefix.shape[1] - 1 :, :].astype(mx.float32)
        value = response_objective(logits, target, args.loss_prefix_tokens)
        return (value, logits) if return_logits else value

    def scores(pixel_values, cached=None):
        was_training = model.training
        if args.reference_ops:
            model.eval()
        try:
            objective, logits = loss(pixel_values, cached, return_logits=True)
            full = response_objective(logits, target)
            mx.eval(objective, full)
            return objective.item(), full.item()
        finally:
            if was_training:
                model.train()

    if args.score_pattern or args.score_images:
        if args.score_pattern:
            candidate = Image.open(args.score_pattern).convert("RGB")
            report.update(
                status="forward_pattern_diagnostic", pattern=str(args.score_pattern)
            )
            report["warning"] = (
                "Teacher-forced scores are not generated responses. Negative multipliers "
                "reverse the saved clipped pattern, not the unavailable raw gradient."
            )
            variants = [
                ({"multiplier": m}, scale_saved_pattern(image, candidate, m))
                for m in (0, 1, -1, 2, -2, 4, -4, 0)
            ]
        else:
            report["status"] = "forward_image_diagnostic"
            variants = [
                ({"image_path": str(path)}, Image.open(path).convert("RGB"))
                for path in (args.image, *args.score_images, args.image)
            ]
        started = time.monotonic()
        records = []
        # Repeated baseline checks test order/state drift as well as both signs.
        for identity, variant in variants:
            if variant.size != image.size:
                raise ValueError("Scored images must have matching dimensions")
            prepared_variant = prepare_inputs(
                processor, images=[variant], prompts=prompt
            )
            if not mx.array_equal(prepared_variant["input_ids"], prefix).item():
                raise ValueError("Variant changed token IDs")
            if not mx.array_equal(prepared_variant["image_grid_thw"], grid).item():
                raise ValueError("Variant changed image grid")
            variant_pixels = prepared_variant["pixel_values"]
            direct_value, target_logits = loss(variant_pixels, return_logits=True)
            direct_objective = direct_value.item()
            direct = response_objective(target_logits, target).item()
            rows = target_logits[0]
            selected = mx.take_along_axis(rows, target[:, None], axis=-1).squeeze(-1)
            token_nll = mx.logsumexp(rows, axis=-1) - selected
            ranks = mx.sum(rows > selected[:, None], axis=-1) + 1
            first_top_ids = mx.argsort(rows[0])[-5:][::-1].tolist()
            requested_top5 = []
            for position in args.diagnostic_position:
                top_ids = mx.argsort(rows[position - 1])[-5:][::-1].tolist()
                requested_top5.append(
                    {
                        "position": position,
                        "target_id": int(target[position - 1].item()),
                        "target_text": processor.tokenizer.decode(
                            [int(target[position - 1].item())]
                        ),
                        "top5": [
                            {
                                "id": token_id,
                                "text": processor.tokenizer.decode([token_id]),
                            }
                            for token_id in top_ids
                        ],
                    }
                )
            token_diagnostics = {
                "warning": "Later token scores are teacher-forced, not a generated continuation.",
                "target_token_ids": target.tolist(),
                "target_token_pieces": processor.tokenizer.convert_ids_to_tokens(
                    target.tolist()
                ),
                "target_token_nll": token_nll.tolist(),
                "target_token_ranks": ranks.tolist(),
                "first_position_top5": [
                    {"id": token_id, "text": processor.tokenizer.decode([token_id])}
                    for token_id in first_top_ids
                ],
                "requested_position_top5": requested_top5,
            }
            hidden = model.vision_tower(
                variant_pixels.astype(model.vision_tower.patch_embed.proj.weight.dtype),
                grid,
                output_hidden_states=False,
            )
            cached_objective, cached = scores(variant_pixels, hidden)
            delta = np.asarray(variant, dtype=np.int16) - np.asarray(
                image, dtype=np.int16
            )
            record = {
                **identity,
                "target_nll": direct,
                "cached_target_nll": cached,
                "cached_difference": cached - direct,
                "objective_loss": direct_objective,
                "cached_objective_loss": cached_objective,
                "changed_channels": int(np.count_nonzero(delta)),
                "max_channel_change": int(np.max(np.abs(delta))),
                "token_diagnostics": token_diagnostics,
            }
            records.append(record)
            print(json.dumps(record), flush=True)
            del (
                hidden,
                variant_pixels,
                prepared_variant,
                rows,
                target_logits,
                direct_value,
            )
            mx.clear_cache()
        report.update(
            records=records,
            seconds=round(time.monotonic() - started, 2),
            peak_memory_bytes=mx.get_peak_memory(),
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n")
        return

    print(json.dumps({"phase": "input_gradient", **report}), flush=True)
    started = time.monotonic()
    restore_attention = None
    try:
        if args.reference_ops:
            baseline = loss(pixels).item()
            # Frozen weights remain frozen. The installed training path uses
            # differentiable reference ops; ordinary scoring stays in eval mode.
            model.train()
            checked = loss(pixels).item()
            report["reference_ops_objective_difference"] = checked - baseline
            mx.clear_cache()
            mx.reset_peak_memory()
        if args.attention_adjoint:
            baseline = loss(pixels).item()
            restore_attention = install_attention_adjoint()
            checked = loss(pixels).item()
            report["attention_adjoint_forward_objective_difference"] = abs(
                checked - baseline
            )
            if checked != baseline:
                raise ValueError("Attention adjoint changed forward loss")
            mx.clear_cache()
            mx.reset_peak_memory()
        if args.patch_adjoint:
            baseline = loss(pixels).item()
            report["patch_adjoint_unit_check"] = install_patch_adjoint(model)
            checked = loss(pixels).item()
            report["patch_adjoint_forward_objective_difference"] = abs(
                checked - baseline
            )
            if checked != baseline:
                raise ValueError("Patch adjoint changed forward loss")
            mx.clear_cache()
            mx.reset_peak_memory()
        if args.checkpoint:
            baseline = loss(pixels).item()
            checkpoint_blocks(model, vision=not args.layerwise)
            checked = loss(pixels).item()
            report["checkpoint_forward_objective_difference"] = abs(checked - baseline)
            if abs(checked - baseline) > 1e-6:
                raise ValueError("Checkpoint wrapper changed forward loss")
            mx.clear_cache()
            mx.reset_peak_memory()
        if args.split:

            def vision(pixel_values):
                cast = pixel_values.astype(
                    model.vision_tower.patch_embed.proj.weight.dtype
                )
                if config.get("model_type") == "qwen3_5":
                    return model.vision_tower(cast, grid)[0]
                return model.vision_tower(cast, grid, output_hidden_states=False)

            hidden = mx.stop_gradient(vision(pixels))
            mx.eval(hidden)
            if args.layerwise_language:
                features = model.get_input_embeddings(
                    ids, pixels, image_grid_thw=grid, cached_image_features=hidden
                )
                value, token_cotangent = language_input_vjp(
                    model.language_model,
                    ids,
                    {k: v for k, v in features.to_dict().items() if v is not None},
                    lambda logits: response_objective(
                        logits[:, prefix.shape[1] - 1 :, :].astype(mx.float32),
                        target,
                        args.loss_prefix_tokens,
                    ),
                )
                _, (cotangent,) = mx.vjp(
                    lambda h: (
                        model.get_input_embeddings(
                            ids, pixels, image_grid_thw=grid, cached_image_features=h
                        ).inputs_embeds
                    ),
                    [hidden],
                    [token_cotangent],
                )
            else:
                value, cotangent = mx.value_and_grad(lambda h: loss(pixels, h))(hidden)
            mx.eval(value, cotangent)
            report["language_backward_peak_bytes"] = mx.get_peak_memory()
            report["language_backward_active_bytes"] = mx.get_active_memory()
            mx.clear_cache()
            mx.reset_peak_memory()
            if args.layerwise:
                gradient = layerwise_vision_vjp(
                    model.vision_tower,
                    grid,
                    pixels.astype(model.vision_tower.patch_embed.proj.weight.dtype),
                    mx.stop_gradient(cotangent),
                ).astype(pixels.dtype)
            else:
                _, (gradient,) = mx.vjp(vision, [pixels], [mx.stop_gradient(cotangent)])
        else:
            value, gradient = mx.value_and_grad(loss)(pixels)
        mx.eval(value, gradient)
        report.update(
            autodiff_objective_loss=float(value.item()),
            gradient_finite=bool(mx.all(mx.isfinite(gradient)).item()),
            gradient_max_abs=float(mx.max(mx.abs(gradient)).item()),
            gradient_l2=float(mx.sqrt(mx.sum(gradient.astype(mx.float32) ** 2)).item()),
            peak_memory_bytes=mx.get_peak_memory(),
        )
        baseline_objective, baseline_nll = scores(pixels)
        report.update(
            target_nll=baseline_nll,
            ordinary_forward_baseline_nll=baseline_nll,
            ordinary_forward_baseline_objective=baseline_objective,
        )
        if args.tensor_line_search:
            line_search = []
            sign_gradient = mx.sign(gradient)
            for amount in (1e-4, 1e-3, 5e-3, 1e-2):
                for direction in (-1, 1):
                    candidate_pixels = pixels + direction * amount * sign_gradient
                    candidate_objective, candidate_nll = scores(candidate_pixels)
                    line_search.append(
                        {
                            "signed_step": direction * amount,
                            "objective_loss": candidate_objective,
                            "target_nll": candidate_nll,
                            "objective_improved": candidate_objective
                            < baseline_objective,
                        }
                    )
                    del candidate_pixels
                    mx.clear_cache()
            report["prepared_tensor_line_search"] = line_search
        if args.candidate_step:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            gradient_path = args.output.parent / "processed-pixel-gradient.npy"
            if gradient_path.exists():
                raise ValueError("Refusing to overwrite an existing gradient")
            np.save(gradient_path, np.asarray(gradient.astype(mx.float32)))
            report["saved_gradient"] = str(gradient_path)
            candidates = []
            for step in dict.fromkeys(args.step_sizes):
                candidate = pixel_step(
                    image,
                    gradient,
                    grid,
                    processor,
                    renderer_adjoint=bool(args.rendered_reference),
                    step=step,
                    budget_reference=budget_reference,
                    protected_mask=protected_mask,
                    bicubic_adjoint=args.bicubic_adjoint,
                    protected_budget=args.content_budget or 0,
                )
                rendered = (
                    render_surrogate(candidate)
                    if args.rendered_reference
                    else candidate
                )
                after = prepare_inputs(processor, images=[rendered], prompts=prompt)
                if not mx.array_equal(after["input_ids"], prefix).item():
                    raise ValueError(
                        "Candidate unexpectedly changed prompt/image token count"
                    )
                after_objective, after_loss = scores(after["pixel_values"])
                path = args.output.parent / f"candidate-step-{step}.png"
                if path.exists():
                    raise ValueError("Refusing to overwrite an existing candidate")
                candidate.save(path)
                result = {
                    "path": str(path),
                    "target_nll": after_loss,
                    "objective_loss": after_objective,
                    "max_channel_change": step,
                    "cumulative_max_channel_change": int(
                        np.max(
                            np.abs(
                                np.asarray(candidate, dtype=np.int16)
                                - np.asarray(
                                    budget_reference
                                    if budget_reference is not None
                                    else image,
                                    dtype=np.int16,
                                )
                            )
                        )
                    ),
                    "pixel_size": list(candidate.size),
                    "backward_resize": "pillow_float_bicubic_adjoint_byte_STE"
                    if args.bicubic_adjoint
                    else "bilinear_BPDA_approximation",
                    "backward_pdf_render": "interpolation_adjoint_byte_STE"
                    if args.rendered_reference
                    else None,
                    "forward_improved": after_loss
                    < report["ordinary_forward_baseline_nll"],
                    "objective_improved": after_objective < baseline_objective,
                    "free_generation": "not_tested",
                    "pdf_round_trip": "not_tested",
                    "human_invisibility": "not_established",
                }
                candidates.append(result)
                print(json.dumps({"phase": "candidate_score", **result}), flush=True)
            report["candidate_steps"] = candidates
            report["lowest_nll_candidate"] = min(
                candidates, key=lambda item: item["target_nll"]
            )
            report["best_objective_candidate"] = min(
                candidates, key=lambda item: item["objective_loss"]
            )
    except (RuntimeError, ValueError) as error:
        report.update(status="gradient_unavailable", error=str(error))
        raise
    finally:
        model.eval()
        if restore_attention is not None:
            restore_attention()
        report["seconds"] = round(time.monotonic() - started, 2)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
