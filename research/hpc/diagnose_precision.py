"""Compare repeated forward/backward calls and SDPA backends after a failed gate.

This diagnostic does not relax the numerical gate or authorize optimization.
"""
import argparse
from contextlib import nullcontext
import gc
import json
from pathlib import Path

import numpy as np
from PIL import Image
import torch
from torch.nn.attention import SDPBackend, sdpa_kernel

from diagnostic_checkpoint import checkpoint_qwen
from numerical_protocol import STEPS, comparison
from precision_preflight import configure_precision
from torch_document import FrozenQwen, sha256, write_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('model', 'image', 'prompts', 'failed', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    previous = json.loads((args.failed / 'report.json').read_text())
    if previous['input_sha256'] != sha256(args.image):
        raise ValueError('Source image mismatch')
    if previous['prompts_sha256'] != sha256(args.prompts):
        raise ValueError('Prompt mismatch')
    args.output.mkdir(parents=True, exist_ok=False)
    config = json.loads(args.prompts.read_text())
    source = Image.open(args.image).convert('RGB')
    base = np.load(args.failed / 'states.npz')['clean_interior']
    direction = np.load(args.failed / 'directions-clean_interior-0.npz')['all']
    report = {'status': 'running', 'failed_report_sha256': sha256(args.failed / 'report.json'),
              'torch_version': torch.__version__, 'cuda_version': torch.version.cuda,
              'scope': 'First prompt and clean interior; identical saved direction; diagnostic only.',
              'rows': []}
    write_json(args.output / 'report.json', report)
    for precision in ('float32', 'bfloat16'):
        for backend in ('default', 'math'):
            runner = FrozenQwen(str(args.model))
            dtype = configure_precision(runner, precision)
            checkpointed_blocks = checkpoint_qwen(runner) if backend == 'math' else 0
            state = runner.state(source, config['train'][0], config['target'])
            row = {'precision': precision, 'backend': backend, 'dtype': dtype,
                   'checkpointed_blocks': checkpointed_blocks,
                   'base_losses': [], 'gradient_repeats': [], 'checks': []}
            report['rows'].append(row)
            write_json(args.output / 'report.json', report)
            context = sdpa_kernel(SDPBackend.MATH) if backend == 'math' else nullcontext()
            with context:
                with torch.no_grad():
                    for _ in range(3):
                        row['base_losses'].append(float(runner.loss(torch.tensor(base, device=runner.device), state)))
                        write_json(args.output / 'report.json', report)
                for _ in range(2):
                    row['phase'] = 'gradient'
                    write_json(args.output / 'report.json', report)
                    value = torch.tensor(base, device=runner.device, requires_grad=True)
                    loss = runner.loss(value, state)
                    gradient = torch.autograd.grad(loss, value)[0].detach().float().cpu().numpy()
                    if not np.isfinite(gradient).all():
                        raise RuntimeError('Non-finite gradient in diagnostic')
                    row['gradient_repeats'].append({
                        'loss': float(loss.detach()),
                        'max_abs': float(np.abs(gradient).max()),
                        'l2': float(np.linalg.norm(gradient.astype(np.float64))),
                        'analytic': float(np.sum(gradient.astype(np.float64) * direction)),
                    })
                    del loss, value
                    write_json(args.output / 'report.json', report)
                with torch.no_grad():
                    for step in STEPS:
                        plus = float(runner.loss(torch.tensor(base + step * direction, device=runner.device), state))
                        minus = float(runner.loss(torch.tensor(base - step * direction, device=runner.device), state))
                        row['checks'].append(comparison(row['gradient_repeats'][0]['analytic'], plus, minus, step))
                        write_json(args.output / 'report.json', report)
            row['phase'] = 'complete'
            row['peak_cuda_memory_bytes'] = torch.cuda.max_memory_allocated()
            write_json(args.output / 'report.json', report)
            print(json.dumps(row), flush=True)
            del runner, state, gradient
            gc.collect()
            torch.cuda.empty_cache()
            torch.cuda.reset_peak_memory_stats()
    report['status'] = 'diagnostic_complete_pending_interpretation'
    write_json(args.output / 'report.json', report)


if __name__ == '__main__':
    main()
