"""Create one E/U parent bank with FP64 loss arithmetic and real byte proposals."""
import argparse
import io
import json
import math
import time
from pathlib import Path

import numpy as np
from PIL import Image
import torch

from fp64_behavior_common import digest, implementation_hashes, validate_inputs


def proposal_bytes(value, direction, lower, upper, step):
    from torch_document import quantize
    clipped = torch.maximum(lower, torch.minimum(upper, value - step / 255 * direction))
    pixels = quantize(clipped)
    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, format='PNG')
    buffer.seek(0)
    decoded = np.array(Image.open(buffer).convert('RGB'))
    if not np.array_equal(decoded, pixels):
        raise RuntimeError('PNG proposal round trip changed pixels')
    return decoded


def choose_proposal(before, current, trials):
    if not all(math.isfinite(row[0]) for row in [(before, current, 0)] + trials):
        raise RuntimeError('Non-finite proposal loss')
    # Stable ties preserve the existing byte image.
    return min([(before, current, 0)] + trials, key=lambda row: row[0])


def main():
    from diagnose_full_precision import configure_reference
    from math_optimizer import enable_math_optimizer
    from run_pilot import TRANSFORMS
    from torch_document import FrozenQwen, bounds, metrics, transformed_input, write_json

    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('model', 'image', 'prompts', 'reference', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--arm', choices=('E', 'U'), required=True)
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    gate = validate_inputs(args)
    source = np.array(Image.open(args.image).convert('RGB'))
    config = json.loads(args.prompts.read_text())
    hashes = implementation_hashes()
    manifest = {'protocol': 'fp64-behavior-v1', 'status': 'optimizing', 'arm': args.arm,
                'seed': 17, 'iterations_per_arm': 36, 'input_sha256': digest(args.image),
                'prompts_sha256': digest(args.prompts), 'reference_sha256': digest(args.reference),
                'implementation_sha256': hashes, 'completed_updates': 0, 'history': [], 'checkpoints': []}
    if args.resume:
        previous = json.loads((args.output / 'manifest.json').read_text())
        for key in ('protocol', 'arm', 'seed', 'iterations_per_arm', 'input_sha256',
                    'prompts_sha256', 'reference_sha256', 'implementation_sha256'):
            if previous[key] != manifest[key]:
                raise RuntimeError('Optimization resume mismatch: ' + key)
        manifest = previous
        current_path = args.output / manifest['current_image']
        if digest(current_path) != manifest['current_image_sha256']:
            raise RuntimeError('Resume image hash mismatch')
        current_np = np.array(Image.open(current_path).convert('RGB'))
    else:
        args.output.mkdir(parents=True, exist_ok=False)
        current_np = source.copy()
        Image.fromarray(source).save(args.output / 'candidate-0000.png')
        manifest['checkpoints'] = [{'name': 'candidate-0000', 'sha256': digest(args.output / 'candidate-0000.png')}]
        manifest.update(current_image='candidate-0000.png', current_image_sha256=digest(args.output / 'candidate-0000.png'))
    def save():
        write_json(args.output / 'manifest.json', manifest)
    save()
    runner = FrozenQwen(str(args.model))
    manifest['precision'] = configure_reference(runner)
    manifest['execution'] = enable_math_optimizer(runner)
    if (manifest['precision'] != gate['shards'][0]['report']['precision']
            or manifest['execution'] != gate['shards'][0]['report']['execution']):
        raise RuntimeError('Optimizer differs from validated reference')
    image = Image.fromarray(source)
    policy = [runner.state(image, prompt, config['target']) for prompt in config['train']]
    utility = [runner.state(image, row['prompt'], row['target']) for row in config['utility_train']]
    lower_np, upper_np, protected = bounds(source)
    lower, upper = [torch.tensor(a, dtype=torch.float64, device=runner.device) for a in (lower_np, upper_np)]
    rng = np.random.default_rng(17)
    schedule = [(int(rng.integers(len(policy))), str(rng.choice(TRANSFORMS))) for _ in range(36)]
    started = time.monotonic()
    for index in range(manifest['completed_updates'], 36):
        prompt_index, transform = schedule[index]
        utility_step = args.arm == 'U' and index % 3 == 2
        state = utility[(index // 3) % len(utility)] if utility_step else policy[prompt_index]
        # Retain the original byte-normalization convention, promoted to FP64.
        value = torch.tensor(current_np.astype(np.float32) / 255, dtype=torch.float64,
                             device=runner.device, requires_grad=True)
        loss = runner.loss(transformed_input(value, transform), state)
        gradient = torch.autograd.grad(loss, value)[0]
        if gradient.dtype != torch.float64 or not torch.isfinite(gradient).all():
            raise RuntimeError('Invalid FP64 input gradient')
        direction = gradient.detach().sign()
        before = float(loss.detach())
        del loss, gradient
        trials = []
        with torch.no_grad():
            for step in (1, 2, 4):
                pixels = proposal_bytes(value, direction, lower, upper, step)
                measured = metrics(source, pixels, protected)
                if measured['linf_bytes'] > 8 or measured['protected_changed_channels']:
                    raise RuntimeError('Proposal violates original pixel constraint')
                proposal = torch.tensor(pixels.astype(np.float32) / 255, dtype=torch.float64, device=runner.device)
                after = float(runner.loss(transformed_input(proposal, transform), state))
                trials.append((after, pixels, step))
        after, current_np, chosen = choose_proposal(before, current_np, trials)
        del value, direction, proposal
        measured = metrics(source, current_np, protected)
        filename = f'update-{index + 1:04d}.png'
        temporary = args.output / (filename + '.partial')
        Image.fromarray(current_np).save(temporary, format='PNG')
        temporary.replace(args.output / filename)
        if not np.array_equal(np.array(Image.open(args.output / filename)), current_np):
            raise RuntimeError('Saved update pixels changed')
        row = {'iteration': index + 1, 'kind': 'utility' if utility_step else 'policy',
               'prompt_index': (index // 3) % len(utility) if utility_step else prompt_index,
               'transform': transform, 'before': before, 'after': after, 'selected_step_bytes': chosen,
               'trials': [{'step_bytes': step, 'loss': loss} for loss, _, step in trials], **measured}
        manifest['history'].append(row)
        manifest.update(completed_updates=index + 1, current_image=filename,
                        current_image_sha256=digest(args.output / filename),
                        peak_cuda_memory_bytes=torch.cuda.max_memory_allocated(),
                        elapsed_seconds_this_execution=time.monotonic() - started)
        if (index + 1) % 6 == 0:
            name = f'candidate-{index + 1:04d}'
            Image.fromarray(current_np).save(args.output / (name + '.png'))
            manifest['checkpoints'].append({'name': name, 'sha256': digest(args.output / (name + '.png'))})
        save()
        print(json.dumps({'event': 'optimization_update', 'arm': args.arm, **row}), flush=True)
    if any(p.grad is not None for p in runner.model.parameters()):
        raise RuntimeError('Model parameters received gradients')
    if len(manifest['history']) != 36 or len(manifest['checkpoints']) != 7:
        raise RuntimeError('Incomplete optimization budget')
    manifest['status'] = 'parent_bank_complete_pending_bf16_selection'
    save()


if __name__ == '__main__':
    main()
