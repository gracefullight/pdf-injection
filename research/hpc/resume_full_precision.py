"""Resume one state/prompt shard of the unchanged full-FP64 diagnostic.

Reuse only hash-verified gradients and a validated prefix of saved comparisons.
Each shard completes three directions. No shard alone passes the full reference.
"""
import argparse
import copy
import json
import shutil
import time
from pathlib import Path

import numpy as np
import torch

import diagnose_full_precision as reference
from numerical_protocol import comparison, stable_agreement

ORIGINAL_SCRIPT_SHA256 = '3d120d4fb340a6ce84174248933aa3835219b0e71826e56f1da764c7750089b8'
DIRECTIONS = ('all', 'even_tiles', 'odd_tiles')


def validated_prefix(row, analytic):
    checks = row.get('checks', [])
    if len(checks) > len(reference.STEPS):
        raise ValueError('Too many saved comparisons')
    for step, check in zip(reference.STEPS, checks):
        if check['step'] != step or check['analytic'] != analytic:
            raise ValueError('Saved step or gradient projection changed')
        expected = comparison(analytic, check['plus_loss'], check['minus_loss'], step)
        if expected != check:
            raise ValueError('Saved comparison arithmetic or decision changed')
    return copy.deepcopy(checks)


def main():
    from PIL import Image
    from math_optimizer import enable_math_optimizer, verify_math_gate
    from torch_document import FrozenQwen, bounds, sha256, write_json

    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('model', 'image', 'prompts', 'failed', 'decoder-report', 'resume', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--state', choices=('clean_interior', 'crossover_interior'), required=True)
    parser.add_argument('--prompt-index', type=int, choices=(0, 1), required=True)
    args = parser.parse_args()
    old = json.loads((args.resume / 'report.json').read_text())
    gate = json.loads((args.failed / 'report.json').read_text())
    if (sha256(reference.__file__) != ORIGINAL_SCRIPT_SHA256
            or old['script_sha256'] != ORIGINAL_SCRIPT_SHA256
            or old['protocol'] != 'full-fp64-scale-v1'
            or old['steps'] != list(reference.STEPS)
            or old['failed_report_sha256'] != sha256(args.failed / 'report.json')
            or old['decoder_report_sha256'] != sha256(args.decoder_report)
            or old['input_sha256'] != sha256(args.image)
            or old['prompts_sha256'] != sha256(args.prompts)):
        raise RuntimeError('Resume provenance mismatch')
    verify_math_gate(gate)
    source = np.array(Image.open(args.image).convert('RGB'))
    lo, hi, protected = bounds(source)
    with np.load(args.failed / 'states.npz') as states:
        base = states[args.state].astype(np.float64)
    direction_file = args.failed / f'directions-{args.state}-{args.prompt_index}.npz'
    with np.load(direction_file) as data:
        bank = {name: data[name].astype(np.float64) for name in DIRECTIONS}
    config = json.loads(args.prompts.read_text())
    archive_name = f'gradient-{args.state}-{args.prompt_index}.npz'
    saved = old['artifacts'].get(archive_name)
    old_rows = [r for r in old['checks'] if r['state'] == args.state and r['train_prompt_index'] == args.prompt_index]
    if len({r['direction'] for r in old_rows}) != len(old_rows):
        raise RuntimeError('Duplicate resume direction')
    if old_rows and not saved:
        raise RuntimeError('Saved rows have no gradient archive')
    args.output.mkdir(parents=True, exist_ok=False)
    report = {key: copy.deepcopy(old[key]) for key in
              ('protocol', 'steps', 'script_sha256', 'failed_report_sha256', 'decoder_report_sha256',
               'input_sha256', 'prompts_sha256', 'scope')}
    report.update(status='running', shard={'state': args.state, 'prompt_index': args.prompt_index},
                  resume_report_sha256=sha256(args.resume / 'report.json'),
                  resume_runner_sha256=sha256(__file__), checks=[], artifacts={}, base_repeats=[],
                  optimizer_authorized=False, full_reference_passed=False, reused_pairs=0)
    def save():
        write_json(args.output / 'report.json', report)
    save()
    runner = FrozenQwen(str(args.model))
    report['precision'] = reference.configure_reference(runner)
    report['execution'] = enable_math_optimizer(runner)
    if report['precision'] != old['precision'] or report['execution'] != old['execution']:
        raise RuntimeError('Reference implementation changed during resume')
    observed = {}
    def observe(module, inputs, output):
        value = output[0] if isinstance(output, tuple) else output
        observed.setdefault(type(module).__name__, set()).add(str(value.dtype))
        if value.dtype != torch.float64:
            raise RuntimeError('Input-dependent boundary narrowed')
    checked = {'Qwen2RMSNorm', 'Conv3d', 'Linear', 'Qwen2_5_VLVisionBlock', 'Qwen2_5_VLDecoderLayer'}
    handles = [m.register_forward_hook(observe) for m in runner.model.modules() if type(m).__name__ in checked]
    task = runner.state(Image.fromarray(source), config['train'][args.prompt_index], config['target'])
    if saved:
        archive = args.resume / archive_name
        if archive.stat().st_size != saved['bytes'] or sha256(archive) != saved['sha256']:
            raise RuntimeError('Gradient checkpoint hash or size mismatch')
        with np.load(archive) as data:
            gradient = data['gradient'].copy()
            if not np.array_equal(data['base'], base) or any(not np.array_equal(data[n], bank[n]) for n in DIRECTIONS):
                raise RuntimeError('Checkpoint state or directions changed')
        records = [r for r in old['base_repeats'] if r['state'] == args.state and r['prompt'] == args.prompt_index]
        if len(records) != 1 or not records[0]['bitwise_equal_losses']:
            raise RuntimeError('Missing repeatability prerequisite')
        base_loss = records[0]['gradient_forward']
        shutil.copyfile(archive, args.output / archive_name)
        report['gradient_reused'] = True
    else:
        value = torch.tensor(base, device=runner.device, requires_grad=True)
        loss = runner.loss(value, task)
        gradient = torch.autograd.grad(loss, value)[0].detach().cpu().numpy()
        base_loss = float(loss.detach())
        del loss, value
        archive = args.output / archive_name
        with archive.with_suffix('.partial').open('wb') as handle:
            np.savez_compressed(handle, base=base, gradient=gradient, **bank)
        archive.with_suffix('.partial').replace(archive)
        report['gradient_reused'] = False
    if gradient.dtype != np.float64 or gradient.shape != base.shape or not np.isfinite(gradient).all() or not np.any(gradient):
        raise RuntimeError('Invalid gradient checkpoint')
    archive = args.output / archive_name
    report['artifacts'][archive_name] = {'sha256': sha256(archive), 'bytes': archive.stat().st_size}
    save()
    with torch.no_grad():
        repeats = [float(runner.loss(torch.tensor(base, device=runner.device), task)) for _ in range(2)]
    report['base_repeats'].append({'state': args.state, 'prompt': args.prompt_index,
                                  'gradient_forward': base_loss, 'no_grad_forwards': repeats,
                                  'bitwise_equal_losses': repeats == [base_loss] * 2})
    save()
    if repeats != [base_loss] * 2:
        raise RuntimeError('Resume base loss does not exactly reproduce checkpoint')
    for name in DIRECTIONS:
        direction = bank[name]
        if np.any(direction[protected]) or not np.any(direction):
            raise RuntimeError('Invalid saved direction')
        analytic = float(np.sum(gradient * direction))
        previous = next((r for r in old_rows if r['direction'] == name), None)
        if previous and (previous['direction_file_sha256'] != sha256(direction_file) or previous['base_loss'] != base_loss):
            raise RuntimeError('Saved row provenance changed')
        checks = validated_prefix(previous, analytic) if previous else []
        report['reused_pairs'] += len(checks)
        row = {'state': args.state, 'train_prompt_index': args.prompt_index, 'direction': name,
               'direction_file_sha256': sha256(direction_file), 'base_loss': base_loss, 'checks': checks}
        report['checks'].append(row)
        save()
        for step in reference.STEPS[len(checks):]:
            started = time.monotonic()
            plus, minus = reference.exact_pair(base, direction, step)
            if not all(np.all(x >= lo) and np.all(x <= hi) for x in (plus, minus)):
                raise RuntimeError('Input constraint violation')
            with torch.no_grad():
                pl = float(runner.loss(torch.tensor(plus, device=runner.device), task))
                ml = float(runner.loss(torch.tensor(minus, device=runner.device), task))
            row['checks'].append(comparison(analytic, pl, ml, step))
            report['observed_output_dtypes'] = {k: sorted(v) for k, v in observed.items()}
            report['peak_cuda_memory_bytes'] = torch.cuda.max_memory_allocated()
            save()
            print(json.dumps({'event': 'completed_pair', 'direction': name, 'step': step,
                              'relative_error': row['checks'][-1]['relative_error'],
                              'elapsed_seconds': time.monotonic() - started}), flush=True)
        row['stable_agreement'] = stable_agreement(row['checks'])
        save()
    if any(p.grad is not None for p in runner.model.parameters()):
        raise RuntimeError('Model weights received gradients')
    report['shard_passed'] = len(report['checks']) == 3 and all(r['stable_agreement'] for r in report['checks'])
    report['status'] = 'shard_complete_pending_full_grid_audit'
    save()
    for handle in handles:
        handle.remove()
    print(json.dumps({'status': report['status'], 'shard_passed': report['shard_passed']}), flush=True)


if __name__ == '__main__':
    main()
