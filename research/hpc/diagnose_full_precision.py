"""End-to-end FP64 derivative diagnostic with the original saved FP32 directions.

This reference changes arithmetic, not model weights or the behavioral endpoint.
It does not validate the original FP32 optimizer or automatically authorize it.
"""
import argparse
import hashlib
import inspect
import json
from pathlib import Path
from types import MethodType

import numpy as np
import torch
import torch.nn.functional as F

from diagnose_downstream import native_rms_forward
from numerical_protocol import comparison, stable_agreement

STEPS = tuple(2.0 ** exponent for exponent in range(-30, -22))
MODEL_SOURCE_SHA256 = '72bdd5615b7527543ea7e6d69fbe194c40bddd94cab13e2e83696ff1cfb10719'


def exact_pair(base, direction, step):
    base = np.asarray(base, dtype=np.float64)
    delta = np.asarray(direction, dtype=np.float64) * step
    plus, minus = base + delta, base - delta
    if not (np.array_equal(plus - base, delta) and np.array_equal(base - minus, delta)):
        raise ValueError('FP64 displacement was rounded')
    return plus, minus


def rotate_half(value):
    left, right = value.chunk(2, dim=-1)
    return torch.cat((-right, left), dim=-1)


def native_vision_rotation(q, k, cos, sin):
    """Keep input-dependent arithmetic FP64; promote fixed positional constants."""
    def apply(value):
        c, s = cos.unsqueeze(-2).to(value), sin.unsqueeze(-2).to(value)
        return value * c + rotate_half(value) * s
    return apply(q), apply(k)


def fixed_vision_frequencies(self, seqlen):
    seq = torch.arange(seqlen, device=self.inv_freq.device, dtype=torch.float32)
    return torch.outer(seq, self.inv_freq.float())


def configure_reference(runner):
    from transformers.models.qwen2_5_vl import modeling_qwen2_5_vl as modeling
    from torch_document import pack_pixels

    actual = hashlib.sha256(Path(inspect.getfile(modeling)).read_bytes()).hexdigest()
    if actual != MODEL_SOURCE_SHA256:
        raise RuntimeError('Unreviewed modeling source; FP64 overrides require review')
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    runner.model.double().requires_grad_(False)
    overrides = 0
    for module in runner.model.modules():
        if type(module).__name__ == 'Qwen2RMSNorm':
            module.forward = MethodType(native_rms_forward, module)
            overrides += 1
        elif type(module).__name__ == 'Qwen2_5_VisionRotaryEmbedding':
            module.forward = MethodType(fixed_vision_frequencies, module)
    modeling.apply_rotary_pos_emb_vision = native_vision_rotation
    # Keep the original FP32 normalization constants, promoted exactly.
    processor = runner.processor.image_processor
    for name in ('image_mean', 'image_std'):
        setattr(processor, name, np.asarray(getattr(processor, name), dtype=np.float32).tolist())

    def loss(image, state):
        if image.dtype != torch.float64:
            raise TypeError('Reference requires FP64 pixel inputs')
        runner.model.rope_deltas = None
        output = runner.model(input_ids=state['ids'], attention_mask=torch.ones_like(state['ids']),
                              pixel_values=pack_pixels(image, processor), image_grid_thw=state['grid'],
                              use_cache=False)
        logits = output.logits[:, state['prefix_length'] - 1:]
        if logits.dtype != torch.float64:
            raise RuntimeError('Reference logits unexpectedly narrowed')
        return F.cross_entropy(logits.reshape(-1, logits.shape[-1]), state['target'].reshape(-1))

    runner.loss = loss
    return {'modeling_source_sha256': actual, 'rmsnorm_overrides': overrides,
            'parameter_dtypes': sorted({str(p.dtype) for p in runner.model.parameters()}),
            'scope': 'Pixel packing, vision, decoder, head and loss arithmetic FP64. '
                     'Original FP32 normalization and position constants retained. Frozen promoted weights.'}


def main():
    from PIL import Image
    from math_optimizer import enable_math_optimizer, verify_math_gate
    from torch_document import FrozenQwen, bounds, sha256, write_json

    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('model', 'image', 'prompts', 'failed', 'decoder-report', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    gate = json.loads((args.failed / 'report.json').read_text())
    decoder = json.loads(args.decoder_report.read_text())
    if (gate['protocol'] != 'math-sign-ulp-v1' or gate['reference_passed']
            or decoder['status'] != 'diagnostic_complete_pending_interpretation'
            or decoder['failed_report_sha256'] != sha256(args.failed / 'report.json')
            or gate['input_sha256'] != sha256(args.image)
            or gate['prompts_sha256'] != sha256(args.prompts)):
        raise RuntimeError('Input or diagnostic provenance mismatch')
    verify_math_gate(gate)
    args.output.mkdir(parents=True, exist_ok=False)
    report = {'protocol': 'full-fp64-scale-v1', 'status': 'running', 'steps': list(STEPS),
              'script_sha256': sha256(__file__), 'failed_report_sha256': sha256(args.failed / 'report.json'),
              'decoder_report_sha256': sha256(args.decoder_report), 'input_sha256': sha256(args.image),
              'prompts_sha256': sha256(args.prompts), 'checks': [], 'base_repeats': [],
              'artifacts': {}, 'optimizer_authorized': False,
              'scope': 'Smooth identity derivative diagnostic only. Original FP32 gate remains failed.'}
    def save():
        write_json(args.output / 'report.json', report)
    save()
    source = np.array(Image.open(args.image).convert('RGB'))
    lo, hi, protected = bounds(source)
    config = json.loads(args.prompts.read_text())
    runner = FrozenQwen(str(args.model))
    report['precision'] = configure_reference(runner)
    report['execution'] = enable_math_optimizer(runner)
    observed = {}
    handles = []
    checked = {'Qwen2RMSNorm', 'Conv3d', 'Linear', 'Qwen2_5_VLVisionBlock', 'Qwen2_5_VLDecoderLayer'}
    def observe(module, inputs, output):
        value = output[0] if isinstance(output, tuple) else output
        name = type(module).__name__
        observed.setdefault(name, set()).add(str(value.dtype))
        if value.dtype != torch.float64:
            raise RuntimeError('Input-dependent boundary narrowed: ' + name)
    for module in runner.model.modules():
        if type(module).__name__ in checked:
            handles.append(module.register_forward_hook(observe))
    states = np.load(args.failed / 'states.npz')
    for state_name in ('clean_interior', 'crossover_interior'):
        base = states[state_name].astype(np.float64)
        for pi, prompt in enumerate(config['train'][:2]):
            task = runner.state(Image.fromarray(source), prompt, config['target'])
            value = torch.tensor(base, device=runner.device, requires_grad=True)
            loss = runner.loss(value, task)
            gradient = torch.autograd.grad(loss, value)[0].detach().cpu().numpy()
            base_loss = float(loss.detach())
            del value, loss
            if not np.isfinite(gradient).all() or not np.any(gradient):
                raise RuntimeError('Invalid reference gradient')
            with torch.no_grad():
                repeated = [float(runner.loss(torch.tensor(base, device=runner.device), task)) for _ in range(2)]
            report['base_repeats'].append({'state': state_name, 'prompt': pi, 'gradient_forward': base_loss,
                                          'no_grad_forwards': repeated, 'bitwise_equal_losses': repeated == [base_loss] * 2})
            if repeated != [base_loss] * 2:
                raise RuntimeError('Identical-input loss is not repeatable')
            direction_file = args.failed / f'directions-{state_name}-{pi}.npz'
            bank = np.load(direction_file)
            archive = args.output / f'gradient-{state_name}-{pi}.npz'
            np.savez_compressed(archive, base=base, gradient=gradient, **{k: bank[k] for k in bank.files})
            report['artifacts'][archive.name] = {'sha256': sha256(archive), 'bytes': archive.stat().st_size}
            for name in ('all', 'even_tiles', 'odd_tiles'):
                direction = bank[name].astype(np.float64)
                if np.any(direction[protected]) or not np.any(direction):
                    raise RuntimeError('Invalid saved direction or protected-mask violation')
                analytic = float(np.sum(gradient * direction))
                row = {'state': state_name, 'train_prompt_index': pi, 'direction': name,
                       'direction_file_sha256': sha256(direction_file), 'base_loss': base_loss, 'checks': []}
                report['checks'].append(row)
                for step in STEPS:
                    plus, minus = exact_pair(base, direction, step)
                    if not all(np.all(x >= lo) and np.all(x <= hi) for x in (plus, minus)):
                        raise RuntimeError('Input exceeds original constraint')
                    with torch.no_grad():
                        pl = float(runner.loss(torch.tensor(plus, device=runner.device), task))
                        ml = float(runner.loss(torch.tensor(minus, device=runner.device), task))
                    row['checks'].append(comparison(analytic, pl, ml, step))
                    save()
                row['stable_agreement'] = stable_agreement(row['checks'])
                print(json.dumps({'event': 'fp64_direction', 'state': state_name, 'prompt': pi, 'direction': name,
                                  'stable_agreement': row['stable_agreement'],
                                  'relative_errors': [x['relative_error'] for x in row['checks']]}), flush=True)
                save()
    if any(p.grad is not None for p in runner.model.parameters()):
        raise RuntimeError('Model weights received gradients')
    report['observed_output_dtypes'] = {k: sorted(v) for k, v in observed.items()}
    report['peak_cuda_memory_bytes'] = torch.cuda.max_memory_allocated()
    report['reference_passed'] = len(report['checks']) == 12 and all(r['stable_agreement'] for r in report['checks'])
    report['status'] = 'diagnostic_complete_reference_passed' if report['reference_passed'] else 'diagnostic_complete_reference_failed'
    save()
    for handle in handles:
        handle.remove()
    print(json.dumps({'status': report['status'], 'optimizer_authorized': False}), flush=True)


if __name__ == '__main__':
    main()
