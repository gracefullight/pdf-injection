"""Validate frozen CUDA VLM packing, reading and saved-pixel optimization."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import platform
import time

import numpy as np
from PIL import Image
import torch
import transformers

from torch_document import (FrozenQwen, bounds, exact_short_answer, metrics,
                            pack_pixels, quantize, sha256, write_json)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--prompts', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--allow-baseline-reading-failure', action='store_true',
                        help='Record baseline reading failures and continue technical checks.')
    parser.add_argument('--allow-nonimproving-probe', action='store_true',
                        help='Record a non-improving single-step probe as an experimental outcome.')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    report = {'status': 'running', 'input_sha256': sha256(args.image),
              'prompts_sha256': sha256(args.prompts), 'precision': 'bfloat16',
              'python': platform.python_version(), 'torch': torch.__version__,
              'transformers': transformers.__version__,
              'cuda_runtime': torch.version.cuda,
              'warning': 'Not an exact replication of the historical MLX 4-bit model.'}
    report_path = args.output / 'report.json'
    revision_path = args.model.parent / 'model-revision.json'
    if revision_path.is_file():
        report['checkpoint'] = json.loads(revision_path.read_text())
    report['model_config_sha256'] = sha256(args.model / 'config.json')
    report['input_module_sha256'] = sha256(Path(__file__).with_name('torch_document.py'))
    write_json(report_path, report)
    try:
        config = json.loads(args.prompts.read_text())
        image = Image.open(args.image).convert('RGB')
        source = np.array(image)
        report['geometry'] = list(image.size)
        runner = FrozenQwen(str(args.model))
        report['gpu'] = torch.cuda.get_device_name(0)
        batch = runner.prepare([image], config['train'][0])
        pixels = torch.tensor(source.astype(np.float32) / 255, device=runner.device)
        packed = pack_pixels(pixels, runner.processor.image_processor)
        error = float((packed - batch['pixel_values'].float()).abs().max())
        report['packing_max_abs_error'] = error
        report['image_grid_thw'] = batch['image_grid_thw'].tolist()
        if error > 1e-6:
            raise RuntimeError('Packing differs from the reference processor')
        responses = []
        for item in config['utility_train'] + config['utility_dev']:
            row = runner.generate([image], item['prompt'], max_new_tokens=64)
            row['expected'] = item['target']
            row['contains_expected'] = item['target'].casefold() in row['response'].casefold()
            row['exact_normalized_match'] = exact_short_answer(row['response'], item['target'])
            responses.append(row)
            print(json.dumps({'reading': row}), flush=True)
        for prompt in config['dev']:
            responses.append(runner.generate([image], prompt))
        report['clean_reading'] = responses
        report['clean_reading_passed'] = all(
            row['exact_normalized_match'] and not row['incomplete'] for row in responses[:4])
        report['baseline_reading_failure_allowed'] = args.allow_baseline_reading_failure
        write_json(report_path, report)
        if not report['clean_reading_passed'] and not args.allow_baseline_reading_failure:
            raise RuntimeError('Clean visual reading gate failed; review responses before optimization')

        lo, hi, protected = bounds(source)
        lower, upper = [torch.tensor(value, device=runner.device) for value in (lo, hi)]
        state = runner.state(image, config['train'][0], config['target'])
        # Use an interior point for a symmetric finite-difference probe.
        interior = ((lower + upper) / 2).detach().requires_grad_(True)
        loss = runner.loss(interior, state)
        loss.backward()
        grad = interior.grad.detach()
        if not torch.isfinite(grad).all() or not torch.count_nonzero(grad):
            raise RuntimeError('Input gradient is non-finite or identically zero')
        if any(p.grad is not None for p in runner.model.parameters()):
            raise RuntimeError('Model weights received gradients')
        direction = torch.sign(grad) * (upper > lower)
        predicted = float((grad * direction).sum())
        differences = []
        with torch.no_grad():
            for h in (0.125 / 255, 0.5 / 255, 1 / 255):
                plus = float(runner.loss(interior + h * direction, state))
                minus = float(runner.loss(interior - h * direction, state))
                measured = (plus - minus) / (2 * h)
                differences.append({'h': h, 'plus_loss': plus, 'minus_loss': minus,
                                    'finite_difference': measured,
                                    'autograd_directional_derivative': predicted,
                                    'relative_error': abs(measured - predicted) / max(abs(predicted), 1e-9)})
        report['gradient'] = {'loss': float(loss.detach()),
                              'max_abs': float(grad.abs().max()),
                              'nonzero_values': int(torch.count_nonzero(grad)),
                              'frozen_parameter_grads': 0,
                              'directional_checks': differences,
                              'note': 'BF16 finite differences are noise-sensitive; inspect all step sizes.'}
        if predicted <= 0 or not any(row['finite_difference'] > 0 for row in differences):
            raise RuntimeError('No positive finite-difference agreement with the gradient direction')

        # Check actual byte candidates starting from the unmodified image.
        value = pixels.detach().requires_grad_(True)
        clean_loss = runner.loss(value, state)
        clean_loss.backward()
        direction = value.grad.detach().sign()
        candidates = []
        with torch.no_grad():
            for step in (0.5, 1.0, 2.0):
                proposal = torch.maximum(lower, torch.minimum(upper, value - step / 255 * direction))
                candidate = quantize(proposal)
                path = args.output / f'candidate-step-{step:g}.png'
                Image.fromarray(candidate).save(path)
                reloaded = np.array(Image.open(path).convert('RGB'))
                saved_loss = float(runner.loss(value.new_tensor(reloaded / 255), state))
                measured = metrics(source, reloaded, protected)
                assert measured['linf_bytes'] <= 8 and measured['protected_changed_channels'] == 0
                candidates.append(dict(step_bytes=step, loss=saved_loss,
                                       sha256=sha256(path), filename=path.name, **measured))
        report['saved_byte_probe'] = {'clean_loss': float(clean_loss.detach()), 'candidates': candidates}
        best = min(candidates, key=lambda row: row['loss'])
        report['saved_byte_probe']['improved'] = best['loss'] < float(clean_loss.detach())
        selected = Image.open(args.output / best['filename']).convert('RGB')
        report['selected_generated_response'] = runner.generate([selected], config['dev'][0])
        report['peak_cuda_memory_bytes'] = torch.cuda.max_memory_allocated()
        report['nonimproving_probe_allowed'] = args.allow_nonimproving_probe
        if not report['saved_byte_probe']['improved'] and not args.allow_nonimproving_probe:
            raise RuntimeError('No tested quantized step reduced target loss')
        report['technical_checks_passed'] = True
        report['status'] = ('passed' if report['clean_reading_passed']
                            else 'passed_with_baseline_reading_failure')
        if not report['saved_byte_probe']['improved']:
            report['status'] = 'completed_with_nonimproving_probe'
        report['validation_scope'] = (
            'Packing parity, finite nonzero input gradients, frozen weights, positive '
            'directional finite differences and saved-byte bounds. Numerical derivative '
            'accuracy and optimization effectiveness are not established by these checks.')
    except Exception as exc:
        report['status'] = 'failed'
        report['error'] = f'{type(exc).__name__}: {exc}'
        raise
    finally:
        report['elapsed_seconds'] = time.monotonic() - started
        write_json(report_path, report)
        print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
