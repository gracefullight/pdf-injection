"""Frozen Qwen CUDA input path for the document-perturbation continuation.

This is a separately validated BF16 port, not a reproduction of MLX int4 outputs.
Transformers' own processor remains the reference for packing and generation.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path
import re
import time

import numpy as np
from PIL import Image, ImageFilter
import torch
import torch.nn.functional as F
from transformers import AutoProcessor, Qwen2_5_VLForConditionalGeneration


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def exact_short_answer(response, target):
    """Strict normalized short-answer match; never accept a negated substring."""
    def normalize(text):
        return ' '.join(re.findall(r'[a-z0-9]+', text.casefold()))
    return normalize(response) == normalize(target)


def write_json(path, data):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + '.partial')
    temporary.write_text(json.dumps(data, indent=2, allow_nan=False) + '\n')
    temporary.replace(path)


def pack_pixels(image, processor):
    """Differentiable HWC [0,1] packing, with no implicit spatial resize."""
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError('Expected an HWC RGB tensor')
    h, w, c = image.shape
    ps, ms, temporal = (processor.patch_size, processor.merge_size,
                        processor.temporal_patch_size)
    if h % (ps * ms) or w % (ps * ms):
        raise ValueError('Geometry must be a multiple of patch_size * merge_size')
    mean = image.new_tensor(processor.image_mean)
    std = image.new_tensor(processor.image_std)
    normalized = ((image - mean) / std).permute(2, 0, 1)
    gh, gw = h // ps, w // ps
    pixels = normalized[None, None].expand(1, temporal, c, h, w)
    pixels = pixels.reshape(1, 1, temporal, c, gh // ms, ms, ps,
                            gw // ms, ms, ps)
    return pixels.permute(0, 1, 4, 7, 5, 8, 3, 2, 6, 9).reshape(
        gh * gw, c * temporal * ps * ps)


def bounds(source, epsilon=8, padding=2):
    ink = Image.fromarray((source.min(axis=2) < 250).astype(np.uint8) * 255)
    if padding:
        ink = ink.filter(ImageFilter.MaxFilter(2 * padding + 1))
    protected = np.asarray(ink) > 0
    value = source.astype(np.float32) / 255
    budget = np.full_like(value, epsilon / 255)
    budget[protected] = 0
    return np.maximum(0, value - budget), np.minimum(1, value + budget), protected


def quantize(image):
    if isinstance(image, torch.Tensor):
        image = image.detach().float().cpu().numpy()
    return np.clip(np.rint(image * 255), 0, 255).astype(np.uint8)


def metrics(source, candidate, protected):
    delta = candidate.astype(np.int16) - source.astype(np.int16)
    mse = float(np.mean(delta.astype(np.float64) ** 2))
    return dict(linf_bytes=int(np.abs(delta).max()),
                changed_channels=int(np.count_nonzero(delta)),
                protected_changed_channels=int(np.count_nonzero(delta[protected])),
                psnr_db=None if mse == 0 else float(20 * np.log10(255 / np.sqrt(mse))))


def transform_bytes(image, name):
    """Actual byte-valued forward transforms, including the saved PDF path."""
    pil = Image.fromarray(image)
    if name == 'identity':
        return image.copy()
    if name.startswith('jpeg'):
        buffer = io.BytesIO()
        pil.save(buffer, format='JPEG', quality=int(name[4:]), subsampling=0)
        buffer.seek(0)
        return np.array(Image.open(buffer).convert('RGB'))
    if name == 'resize75':
        size = (round(pil.width * .75), round(pil.height * .75))
        return np.array(pil.resize(size, Image.Resampling.LANCZOS).resize(
            pil.size, Image.Resampling.LANCZOS))
    if name in ('pdf112', 'pdf-mupdf112'):
        from document_artifacts import raster_pdf_bytes, render_pdf
        renderer = 'poppler' if name == 'pdf112' else 'pymupdf'
        result = np.array(render_pdf(raster_pdf_bytes([pil]), renderer)[0])
        if result.shape != image.shape:
            raise ValueError('PDF renderer geometry mismatch')
        return result
    raise ValueError(name)


class PopplerInputAdjoint(torch.autograd.Function):
    """Actual PDF forward and the historical interpolation adjoint as BPDA."""

    @staticmethod
    def forward(ctx, image):
        return image.new_tensor(transform_bytes(quantize(image), 'pdf112') / 255)

    @staticmethod
    def backward(ctx, cotangent):
        from pixel_notice_render import input_vjp
        return cotangent.new_tensor(input_vjp(cotangent.detach().float().cpu().numpy()))


def transformed_input(image, name):
    """BPDA: actual quantized forward, declared surrogate derivative.

    Explicitly not an exact derivative of JPEG, resizing or a PDF renderer.
    PDF uses the historical interpolation adjoint; other transforms use identity.
    Selection and evaluation always use saved bytes and actual forward transforms.
    """
    if name == 'pdf112':
        return PopplerInputAdjoint.apply(image)
    actual = image.new_tensor(transform_bytes(quantize(image), name) / 255)
    return image + (actual - image).detach()


class FrozenQwen:
    def __init__(self, checkpoint, *, require_pbs=True):
        if require_pbs and not os.environ.get('PBS_JOBID'):
            raise RuntimeError('Run model computation through PBS')
        if not torch.cuda.is_available():
            raise RuntimeError('CUDA is unavailable')
        expected = int(os.environ.get('PDFI_EXPECTED_VISIBLE_GPUS', '2'))
        if torch.cuda.device_count() != expected:
            raise RuntimeError('Unexpected visible GPU count; verify exclusive allocation')
        self.device = torch.device('cuda:0')
        if not torch.cuda.is_bf16_supported():
            raise RuntimeError('This port requires a GPU with native BF16 support')
        self.processor = AutoProcessor.from_pretrained(
            checkpoint, local_files_only=True, min_pixels=28 * 28,
            max_pixels=2048 * 2048, use_fast=False)
        self.model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
            checkpoint, local_files_only=True, torch_dtype=torch.bfloat16,
            attn_implementation='sdpa').to(self.device).eval()
        self.model.requires_grad_(False)

    def prepare(self, images, prompt):
        content = [{'type': 'image'} for _ in images] + [{'type': 'text', 'text': prompt}]
        text = self.processor.apply_chat_template(
            [{'role': 'user', 'content': content}], tokenize=False, add_generation_prompt=True)
        batch = self.processor(text=[text], images=images, return_tensors='pt')
        return batch.to(self.device)

    def state(self, image, prompt, target):
        batch = self.prepare([image], prompt)
        target_ids = self.processor.tokenizer.encode(target, add_special_tokens=False)
        target_ids = torch.tensor([target_ids], dtype=torch.long, device=self.device)
        prefix = batch['input_ids']
        return dict(ids=torch.cat((prefix, target_ids[:, :-1]), dim=1),
                    grid=batch['image_grid_thw'], target=target_ids,
                    prefix_length=prefix.shape[1])

    def loss(self, image, state):
        pixels = pack_pixels(image, self.processor.image_processor)
        # Reset the mutable generation cache between independent prompts.
        self.model.rope_deltas = None
        output = self.model(input_ids=state['ids'],
                            attention_mask=torch.ones_like(state['ids']),
                            pixel_values=pixels, image_grid_thw=state['grid'],
                            use_cache=False)
        logits = output.logits[:, state['prefix_length'] - 1:].float()
        return F.cross_entropy(logits.reshape(-1, logits.shape[-1]),
                               state['target'].reshape(-1))

    @torch.inference_mode()
    def generate(self, images, prompt, max_new_tokens=192):
        batch = self.prepare(images, prompt)
        self.model.rope_deltas = None
        started = time.monotonic()
        generated = self.model.generate(**batch, max_new_tokens=max_new_tokens,
                                        do_sample=False, use_cache=True)
        new = generated[0, batch['input_ids'].shape[1]:]
        eos = self.model.generation_config.eos_token_id
        eos = [eos] if isinstance(eos, int) else eos
        complete = bool(len(new) and int(new[-1]) in eos)
        return dict(prompt=prompt,
                    response=self.processor.tokenizer.decode(new, skip_special_tokens=True),
                    new_tokens=len(new), ended_with_eos=complete,
                    incomplete=not complete,
                    elapsed_seconds=time.monotonic() - started)
