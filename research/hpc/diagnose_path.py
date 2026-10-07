"""Localize the failed ULP check without changing or replacing its acceptance gate.

First training prompt, saved clean interior, all three saved directions, all seven
steps. Compare grad-enabled/no-grad forwards and boundary cotangent projections.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import torch

from numerical_protocol import ULP_STEPS, comparison, representable_pair


def projection(gradient, direction):
    return float(np.sum(np.asarray(gradient, dtype=np.float64) * direction))


class BoundaryCapture:
    """Capture only outer module boundaries, outside checkpointed blocks."""
    def __init__(self, modules):
        self.values = {}
        self.gradients = {}
        self.capture_gradients = False
        self.handles = [module.register_forward_hook(self._hook(name))
                        for name, module in modules.items()]

    def _hook(self, name):
        def hook(module, args, output):
            if not isinstance(output, torch.Tensor):
                raise TypeError('Boundary output must be a tensor: ' + name)
            self.values[name] = output.detach().float().cpu().numpy().copy()
            if self.capture_gradients:
                if not output.requires_grad:
                    raise ValueError('Missing boundary gradient: ' + name)
                def save(gradient):
                    self.gradients[name] = gradient.detach().float().cpu().numpy().copy()
                output.register_hook(save)
        return hook

    def close(self):
        for handle in self.handles:
            handle.remove()


def boundary_comparison(gradient, plus, minus, step, analytic):
    # Subtract before projection in float64; avoid cancellation between large dots.
    finite = projection(gradient, (plus.astype(np.float64) - minus) / (2 * step))
    absolute = abs(finite - analytic)
    return {'projected_finite_difference': finite, 'absolute_error': absolute,
            'relative_error': absolute / max(abs(finite), abs(analytic), 1e-12),
            'changed_elements': int(np.count_nonzero(plus != minus))}


def main():
    from PIL import Image
    from math_optimizer import enable_math_optimizer, verify_math_gate
    from precision_preflight import array_hash, configure_precision
    from torch_document import FrozenQwen, bounds, pack_pixels, sha256, write_json

    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('model', 'image', 'prompts', 'failed', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    previous = json.loads((args.failed / 'report.json').read_text())
    if (previous['status'] != 'failed_numerical_reference'
            or previous['protocol'] != 'math-sign-ulp-v1'
            or previous['input_sha256'] != sha256(args.image)
            or previous['prompts_sha256'] != sha256(args.prompts)
            or previous['model_config_sha256'] != sha256(args.model / 'config.json')):
        raise ValueError('Failed-gate provenance mismatch')
    verify_math_gate(previous)
    base = np.load(args.failed / 'states.npz')['clean_interior']
    bank = dict(np.load(args.failed / 'directions-clean_interior-0.npz'))
    references = {c['direction']: c for c in previous['checks']
                  if c['precision'] == 'float32' and c['state'] == 'clean_interior'
                  and c['train_prompt_index'] == 0}
    if set(bank) != {'all', 'even_tiles', 'odd_tiles'}:
        raise ValueError('Unexpected saved directions')
    for name, direction in bank.items():
        if (array_hash(base) != references[name]['state_sha256']
                or array_hash(direction) != references[name]['direction_sha256']):
            raise ValueError('Saved state/direction hash mismatch')
    source = np.array(Image.open(args.image).convert('RGB'))
    lo, hi, protected = bounds(source)
    config = json.loads(args.prompts.read_text())
    args.output.mkdir(parents=True, exist_ok=False)
    report = {'status': 'running', 'protocol': 'path-localization-v1',
              'scope': 'Diagnostic only: first prompt and saved clean interior. '
                       'Cannot authorize optimization or replace the full gate.',
              'failed_report_sha256': sha256(args.failed / 'report.json'),
              'input_sha256': sha256(args.image), 'prompts_sha256': sha256(args.prompts),
              'steps': list(ULP_STEPS), 'rows': [], 'base_forwards': [],
              'torch_version': torch.__version__, 'cuda_version': torch.version.cuda,
              'script_sha256': sha256(__file__)}
    write_json(args.output / 'report.json', report)
    runner = FrozenQwen(str(args.model))
    report['dtype'] = configure_precision(runner, 'float32')
    report['optimizer_execution'] = enable_math_optimizer(runner)
    task = runner.state(Image.fromarray(source), config['train'][0], config['target'])
    capture = BoundaryCapture({'patch_embedding': runner.model.visual.patch_embed,
                               'vision_output': runner.model.visual})
    value = torch.tensor(base, device=runner.device, requires_grad=True)
    capture.capture_gradients = True
    loss = runner.loss(value, task)
    loss.backward()
    gradient = value.grad.detach().cpu().numpy().copy()
    if not np.isfinite(gradient).all() or any(p.grad is not None for p in runner.model.parameters()):
        raise RuntimeError('Invalid input gradient or unfrozen weights')
    if set(capture.gradients) != {'patch_embedding', 'vision_output'}:
        raise RuntimeError('Missing boundary cotangents')
    report['base_loss'] = float(loss.detach())
    report['analytic'] = {name: projection(gradient, direction) for name, direction in bank.items()}
    report['previous_analytic'] = {name: references[name]['checks'][0]['analytic'] for name in bank}
    base_values = capture.values.copy()
    capture.capture_gradients = False
    del loss, value
    write_json(args.output / 'report.json', report)

    def forward(array, grad_enabled):
        with torch.set_grad_enabled(grad_enabled):
            image = torch.tensor(array, device=runner.device, requires_grad=grad_enabled)
            loss = runner.loss(image, task)
            result = float(loss.detach())
        # Detaching captured arrays and releasing this graph bounds memory per call.
        return result, capture.values.copy()

    for grad_enabled in (False, True):
        for repeat in range(2):
            loss, values = forward(base, grad_enabled)
            report['base_forwards'].append({'grad_enabled': grad_enabled, 'repeat': repeat,
                'loss': loss, 'boundary_max_abs_difference': {
                    name: float(np.max(np.abs(values[name] - base_values[name]))) for name in values}})
            write_json(args.output / 'report.json', report)
    for name, direction in bank.items():
        if np.any(direction[protected]):
            raise ValueError('Direction changes protected pixels')
        # Packing is affine mathematically. Its ULP response can still be rounded.
        tangent = torch.tensor(direction, device=runner.device)
        pack = lambda x: pack_pixels(x, runner.processor.image_processor)
        _, packed_tangent = torch.autograd.functional.jvp(
            pack, torch.tensor(base, device=runner.device), tangent)
        packed_tangent = packed_tangent.detach().cpu().numpy()
        for step in ULP_STEPS:
            plus, minus = representable_pair(base, direction, step)
            if not (np.all(plus <= hi) and np.all(plus >= lo)
                    and np.all(minus <= hi) and np.all(minus >= lo)):
                raise ValueError('Out-of-box perturbation')
            with torch.no_grad():
                pp = pack(torch.tensor(plus, device=runner.device)).cpu().numpy()
                pm = pack(torch.tensor(minus, device=runner.device)).cpu().numpy()
            actual = (pp.astype(np.float64) - pm) / (2 * step)
            packing_error = float(np.linalg.norm(actual - packed_tangent) /
                                  max(np.linalg.norm(packed_tangent.astype(np.float64)), 1e-12))
            for grad_enabled in (False, True):
                pl, pv = forward(plus, grad_enabled)
                ml, mv = forward(minus, grad_enabled)
                analytic = report['analytic'][name]
                row = {'direction': name, 'grad_enabled': grad_enabled,
                       'loss_check': comparison(analytic, pl, ml, step),
                       'packing_relative_l2_error': packing_error,
                       'boundaries': {boundary: boundary_comparison(capture.gradients[boundary],
                           pv[boundary], mv[boundary], step, analytic) for boundary in capture.gradients}}
                report['rows'].append(row)
                write_json(args.output / 'report.json', report)
                print(json.dumps({'event': 'path_check', 'direction': name, 'step': step,
                                  'grad_enabled': grad_enabled,
                                  'relative_error': row['loss_check']['relative_error']}), flush=True)
    capture.close()
    report['peak_cuda_memory_bytes'] = torch.cuda.max_memory_allocated()
    report['status'] = 'diagnostic_complete_pending_interpretation'
    write_json(args.output / 'report.json', report)


if __name__ == '__main__':
    main()
