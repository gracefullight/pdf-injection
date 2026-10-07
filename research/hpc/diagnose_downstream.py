"""Freeze vision outputs to distinguish decoder arithmetic from loss reduction.

Diagnostic only. Neither this experiment nor its FP64 arm authorizes optimization.
"""
import argparse
import inspect
import json
from pathlib import Path
from types import MethodType

import numpy as np
import torch
import torch.nn.functional as F
from torch.nn.attention import SDPBackend, sdpa_kernel

from numerical_protocol import comparison, representable_pair

SCALES = (.125, .25, .5, 1., 2.)


def reduction_gradients(replay, value, criterion):
    """Use separate graphs: checkpoint recompute contexts are single-use."""
    logits32 = replay(value)
    gradient32 = torch.autograd.grad(criterion(logits32, torch.float32), value)[0].detach()
    del logits32
    logits = replay(value)
    loss = criterion(logits, torch.float64)
    gradient = torch.autograd.grad(loss, value)[0].detach()
    return logits, loss, gradient32, gradient


def native_rms_forward(self, value):
    """Same RMS formula/epsilon; retain input dtype instead of forcing FP32."""
    variance = value.square().mean(-1, keepdim=True)
    return self.weight * (value * torch.rsqrt(variance + self.variance_epsilon))


def realized_projection(gradient, plus, minus, scale):
    delta = (plus.double() - minus.double()) / (2 * scale)
    return float((gradient.double() * delta).sum())


def displacement_record(base, direction, plus, minus, scale):
    requested = direction.double() * scale
    denominator = max(float(torch.linalg.vector_norm(requested)), 1e-300)
    return {'plus_rounding_relative_l2': float(torch.linalg.vector_norm(
                plus.double() - base.double() - requested)) / denominator,
            'minus_rounding_relative_l2': float(torch.linalg.vector_norm(
                base.double() - minus.double() - requested)) / denominator,
            'plus_changed_elements': int(torch.count_nonzero(plus != base)),
            'minus_changed_elements': int(torch.count_nonzero(minus != base))}


def compare_pair(gradient, direction, plus, minus, pl, ml, scale):
    nominal = float((gradient.double() * direction.double()).sum())
    realized = realized_projection(gradient, plus, minus, scale)
    return {'nominal': comparison(nominal, pl, ml, scale),
            'realized_displacement': comparison(realized, pl, ml, scale)}


def main():
    from PIL import Image
    from math_optimizer import enable_math_optimizer, verify_math_gate
    from precision_preflight import array_hash, configure_precision
    from torch_document import FrozenQwen, sha256, write_json

    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('model', 'image', 'prompts', 'failed', 'path-report', 'output'):
        parser.add_argument('--' + key, type=Path, required=True)
    args = parser.parse_args()
    gate = json.loads((args.failed / 'report.json').read_text())
    path_report = json.loads(args.path_report.read_text())
    if (gate['protocol'] != 'math-sign-ulp-v1' or gate['reference_passed']
            or path_report['status'] != 'diagnostic_complete_pending_interpretation'
            or path_report['failed_report_sha256'] != sha256(args.failed / 'report.json')
            or len(path_report['rows']) != 42
            or gate['input_sha256'] != sha256(args.image)
            or gate['prompts_sha256'] != sha256(args.prompts)
            or gate['model_config_sha256'] != sha256(args.model / 'config.json')):
        raise ValueError('Prior diagnostic provenance mismatch')
    verify_math_gate(gate)
    verify_math_gate(path_report)
    base = np.load(args.failed / 'states.npz')['clean_interior']
    direction = np.load(args.failed / 'directions-clean_interior-0.npz')['all']
    reference = next(c for c in gate['checks'] if c['precision'] == 'float32'
                     and c['state'] == 'clean_interior' and c['train_prompt_index'] == 0
                     and c['direction'] == 'all')
    if array_hash(base) != reference['state_sha256'] or array_hash(direction) != reference['direction_sha256']:
        raise ValueError('State/direction hash mismatch')
    plus, minus = representable_pair(base, direction, 2. ** -24)
    args.output.mkdir(parents=True, exist_ok=False)
    report = {'status': 'running', 'protocol': 'frozen-decoder-v1',
              'scope': 'One prompt and one saved vision secant. Diagnostic, not the full gate.',
              'failed_report_sha256': sha256(args.failed / 'report.json'),
              'path_report_sha256': sha256(args.path_report), 'script_sha256': sha256(__file__),
              'scales': list(SCALES), 'captures': [], 'arms': [], 'artifacts': {},
              'loss_only': [], 'torch_version': torch.__version__, 'cuda_version': torch.version.cuda,
              'fp64_scope': 'Decoder/head and RMS arithmetic FP64; fixed FP32 vision embeddings and '
                            'fixed original FP32 RoPE constants promoted exactly. Not a full-model FP64 reference.'}

    def save():
        write_json(args.output / 'report.json', report)

    def archive(name, **arrays):
        arrays = {key: value.detach().cpu().numpy() if isinstance(value, torch.Tensor) else value
                  for key, value in arrays.items()}
        filename = name + '.npz'
        np.savez_compressed(args.output / filename, **arrays)
        report['artifacts'][filename] = {'sha256': sha256(args.output / filename),
                                        'bytes': (args.output / filename).stat().st_size}

    save()
    config = json.loads(args.prompts.read_text())
    runner = FrozenQwen(str(args.model))
    report['modeling_source_sha256'] = sha256(inspect.getfile(type(runner.model)))
    report['fp32_dtype'] = configure_precision(runner, 'float32')
    report['optimizer_execution'] = enable_math_optimizer(runner)
    task = runner.state(Image.open(args.image).convert('RGB'), config['train'][0], config['target'])
    captured = {}

    def decoder_hook(module, positional, keywords):
        if positional:
            raise ValueError('Unexpected positional decoder arguments')
        captured['kwargs'] = {k: v.detach().clone() if isinstance(v, torch.Tensor) else v
                              for k, v in keywords.items()}

    def logits_hook(module, positional, output):
        captured['logits'] = output.logits[:, task['prefix_length'] - 1:].detach().cpu().clone()

    def rotary_hook(module, positional, output):
        captured['rope'] = tuple(v.detach().clone() for v in output)

    handles = [runner.model.model.register_forward_pre_hook(decoder_hook, with_kwargs=True),
               runner.model.register_forward_hook(logits_hook),
               runner.model.model.rotary_emb.register_forward_hook(rotary_hook)]
    embeddings = {}
    capture_logits = {}
    for name, pixels in (('base', base), ('plus', plus), ('minus', minus)):
        with torch.no_grad():
            loss = float(runner.loss(torch.tensor(pixels, device=runner.device), task))
        embeddings[name] = captured['kwargs']['inputs_embeds'].detach().clone()
        capture_logits[name] = captured['logits']
        report['captures'].append({'name': name, 'loss': loss})
        if name == 'base':
            fixed = captured['kwargs'].copy()
            rope = captured['rope']
        else:
            for key in ('position_ids', 'attention_mask'):
                if not torch.equal(fixed[key], captured['kwargs'][key]):
                    raise ValueError('Position/mask changed across pixel captures')
        archive('capture-' + name, embeddings=embeddings[name], logits=capture_logits[name])
        save()
    for handle in handles:
        handle.remove()
    # Freeze all positional inputs: promoted constants are independent of pixel derivatives.
    runner.model.model.rotary_emb.forward = lambda x, position_ids: tuple(v.to(x.dtype) for v in rope)
    archive('fixed-context', position_ids=fixed['position_ids'], attention_mask=fixed['attention_mask'],
            target=task['target'], rope_cos=rope[0], rope_sin=rope[1])
    secant = (embeddings['plus'].double() - embeddings['minus'].double()) / 2
    image_mask = (task['ids'] == runner.model.config.image_token_id).unsqueeze(-1).expand_as(secant)
    if torch.count_nonzero(secant[~image_mask]) or not torch.count_nonzero(secant):
        raise ValueError('Secant must change only vision tokens and be nonzero')
    archive('embedding-secant', direction=secant)

    def replay(value):
        kwargs = {**fixed, 'inputs_embeds': value, 'use_cache': False}
        with sdpa_kernel(SDPBackend.MATH):
            hidden = runner.model.model(**kwargs)[0]
            # Preserve the original full-sequence head GEMM shape in both arms.
            logits = runner.model.lm_head(hidden)[:, task['prefix_length'] - 1:]
        return logits

    def ce(logits, dtype):
        return F.cross_entropy(logits.to(dtype).reshape(-1, logits.shape[-1]), task['target'].reshape(-1))

    # Prove bypass equivalence for all captured inputs before interpreting downstream probes.
    for name in ('base', 'plus', 'minus'):
        with torch.no_grad():
            logits = replay(embeddings[name])
            equal = torch.equal(logits.cpu(), capture_logits[name])
            loss = float(ce(logits, torch.float32))
        report.setdefault('replay_checks', []).append({'name': name, 'logits_bitwise_equal': equal, 'loss': loss})
        save()
        if not equal:
            raise RuntimeError('Decoder replay does not reproduce captured logits')
    del logits, captured

    dtype_observations = {}
    def dtype_hook(module, positional, output):
        value = output[0] if isinstance(output, tuple) else output
        if isinstance(value, torch.Tensor) and value.is_floating_point():
            dtype_observations.setdefault(type(module).__name__, set()).add(str(value.dtype))
    dtype_handles = [m.register_forward_hook(dtype_hook) for m in runner.model.model.modules()
                     if isinstance(m, torch.nn.Linear) or type(m).__name__ in
                     ('Qwen2RMSNorm', 'Qwen2_5_VLDecoderLayer')]
    for arm_name, dtype in (('decoder_fp32', torch.float32), ('decoder_fp64', torch.float64)):
        dtype_observations.clear()
        if dtype == torch.float64:
            runner.model.model.to(dtype=dtype)
            runner.model.lm_head.to(dtype=dtype)
            norms = [m for m in runner.model.model.modules() if type(m).__name__ == 'Qwen2RMSNorm']
            if not norms:
                raise RuntimeError('No RMSNorm modules found for FP64 intervention')
            for norm in norms:
                norm.forward = MethodType(native_rms_forward, norm)
            report['fp64_rmsnorm_overrides'] = len(norms)
        value = embeddings['base'].to(dtype).detach().requires_grad_()
        vector = secant.to(dtype)
        # Each reduction gets its own graph and checkpoint recomputation context.
        logits, loss, gradient32, gradient = reduction_gradients(replay, value, ce)
        arm = {'name': arm_name, 'parameter_dtypes': sorted({str(p.dtype) for p in runner.model.model.parameters()}),
               'head_dtype': str(runner.model.lm_head.weight.dtype), 'base_loss_fp64_reduction': float(loss.detach()),
               'base_loss_fp32_reduction': float(ce(logits.detach(), torch.float32)),
               'gradient_reduction_relative_l2': float(torch.linalg.vector_norm(gradient32.double() - gradient.double()) /
                   torch.linalg.vector_norm(gradient.double()).clamp_min(1e-300)), 'rows': []}
        report['arms'].append(arm)
        archive(arm_name + '-base', gradient=gradient, gradient_fp32_reduction=gradient32, logits=logits.detach())
        base_value = value.detach()
        del value, logits, loss
        save()
        for scale in SCALES:
            pv, mv = base_value + scale * vector, base_value - scale * vector
            with torch.no_grad():
                p_logits, m_logits = replay(pv), replay(mv)
                pl64, ml64 = float(ce(p_logits, torch.float64)), float(ce(m_logits, torch.float64))
                pl32, ml32 = float(ce(p_logits, torch.float32)), float(ce(m_logits, torch.float32))
            row = {'scale': scale, **compare_pair(gradient, vector, pv, mv, pl64, ml64, scale),
                   'rounding': displacement_record(base_value, vector, pv, mv, scale),
                   'loss_fp32_reduction': compare_pair(gradient32, vector, pv, mv, pl32, ml32, scale)}
            archive(arm_name + '-' + str(scale), embeddings_plus=pv, embeddings_minus=mv,
                    logits_plus=p_logits, logits_minus=m_logits)
            arm['rows'].append(row)
            save()
            print(json.dumps({'event': 'frozen_decoder_check', 'arm': arm_name, 'scale': scale,
                              'relative_error': row['realized_displacement']['relative_error']}), flush=True)
            del p_logits, m_logits, pv, mv
        arm['observed_output_dtypes'] = {k: sorted(v) for k, v in dtype_observations.items()}
        if dtype == torch.float64 and any(v != {'torch.float64'} for v in dtype_observations.values()):
            raise RuntimeError('FP64 decoder boundary unexpectedly narrowed')
        if any(p.grad is not None for p in runner.model.parameters()):
            raise RuntimeError('Model parameter received gradient')
        del gradient, gradient32, base_value, vector
        save()

    # Loss-only intervention uses fixed captured FP32 logits promoted exactly to either dtype.
    for dtype in (torch.float32, torch.float64):
        value = capture_logits['base'].to(device=runner.device, dtype=dtype).requires_grad_()
        vector = ((capture_logits['plus'].double() - capture_logits['minus'].double()) / 2).to(value)
        gradient = torch.autograd.grad(ce(value, dtype), value)[0]
        for scale in SCALES:
            pv, mv = value.detach() + scale * vector, value.detach() - scale * vector
            with torch.no_grad():
                pl, ml = float(ce(pv, dtype)), float(ce(mv, dtype))
            report['loss_only'].append({'dtype': str(dtype), 'scale': scale,
                **compare_pair(gradient, vector, pv, mv, pl, ml, scale),
                'rounding': displacement_record(value.detach(), vector, pv, mv, scale)})
        archive('loss-only-' + str(dtype), gradient=gradient, direction=vector)
        save()
    for handle in dtype_handles:
        handle.remove()
    report['peak_cuda_memory_bytes'] = torch.cuda.max_memory_allocated()
    report['status'] = 'diagnostic_complete_pending_interpretation'
    save()


if __name__ == '__main__':
    main()
