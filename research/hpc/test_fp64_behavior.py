"""Regression checks for byte proposals, reference rejection and bank integrity."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image
import torch
from fp64_behavior_common import validate_reference, digest
from optimize_fp64_behavior import choose_proposal, proposal_bytes
from torch_document import bounds, metrics


def reference():
    shards = []
    for state in ('clean_interior', 'crossover_interior'):
        for prompt in (0, 1):
            checks = [{'state': state, 'train_prompt_index': prompt, 'direction': direction,
                       'checks': [{} for _ in range(8)], 'stable_agreement': True}
                      for direction in ('all', 'even_tiles', 'odd_tiles')]
            shards.append({'exit_status': 0, 'report': {'shard_passed': True, 'checks': checks}})
    return {'status': 'audited_full_fp64_reference_passed', 'reference_passed': True,
            'scalar_checks_recomputed': 96, 'tensor_projections_reconstructed': 12, 'shards': shards}


class BehaviorTests(unittest.TestCase):
    def test_reference_requires_complete_unique_passed_grid(self):
        validate_reference(reference())
        for mutation in ('missing', 'duplicate', 'failed', 'steps', 'exit', 'unaudited'):
            gate = reference()
            if mutation == 'missing': gate['shards'].pop()
            elif mutation == 'duplicate': gate['shards'].append(copy.deepcopy(gate['shards'][0]))
            elif mutation == 'failed': gate['shards'][0]['report']['checks'][0]['stable_agreement'] = False
            elif mutation == 'steps': gate['shards'][0]['report']['checks'][0]['checks'].pop()
            elif mutation == 'exit': gate['shards'][0]['exit_status'] = 1
            else: gate['tensor_projections_reconstructed'] = 0
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                validate_reference(gate)

    def test_repeated_fp64_proposals_preserve_text_and_byte_budget(self):
        source = np.full((28, 28, 3), 255, dtype=np.uint8)
        source[10:13, 10:13] = [3, 80, 170]
        lo, hi, protected = bounds(source)
        lo, hi = torch.tensor(lo, dtype=torch.float64), torch.tensor(hi, dtype=torch.float64)
        current = source.copy()
        for _ in range(10):
            value = torch.tensor(current.astype(np.float32) / 255, dtype=torch.float64)
            current = proposal_bytes(value, torch.ones_like(value), lo, hi, 4)
        measured = metrics(source, current, protected)
        self.assertEqual(measured['linf_bytes'], 8)
        self.assertEqual(measured['protected_changed_channels'], 0)
        self.assertGreater(measured['changed_channels'], 0)

    def test_loss_choice_rejects_worse_and_retains_ties(self):
        a, b = np.zeros((1,)), np.ones((1,))
        self.assertIs(choose_proposal(1., a, [(2., b, 1), (1., b, 2)])[1], a)
        self.assertIs(choose_proposal(1., a, [(.5, b, 1)])[1], b)

    def test_parent_bank_rejects_incomplete_and_changed_pixels(self):
        from evaluate_fp64_behavior import parent_bank
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            rows = []
            for i in range(0, 37, 6):
                name = f'candidate-{i:04d}'
                path = directory / (name + '.png')
                Image.new('RGB', (2, 2), 'white').save(path)
                rows.append({'name': name, 'sha256': digest(path)})
            data = {'arm': 'E', 'completed_updates': 36, 'history': [{}] * 36,
                    'status': 'parent_bank_complete_pending_bf16_selection', 'checkpoints': rows}
            file = directory / 'manifest.json'; file.write_text(json.dumps(data))
            self.assertEqual(len(parent_bank(directory, 'E', {})), 7)
            data['completed_updates'] = 35; file.write_text(json.dumps(data))
            with self.assertRaises(ValueError): parent_bank(directory, 'E', {})
            data['completed_updates'] = 36; file.write_text(json.dumps(data))
            Image.new('RGB', (2, 2), 'black').save(directory / 'candidate-0006.png')
            with self.assertRaises(ValueError): parent_bank(directory, 'E', {})


if __name__ == '__main__':
    unittest.main()
