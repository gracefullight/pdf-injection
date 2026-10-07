"""Protocol tests with a fake decoder; these are not model experiment results."""
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

from evaluate_document import evaluate_pages
from run_pilot import preflight_accepted, provisional_label, select


class RecordingDecoder:
    def __init__(self):
        self.prompts = []

    def generate(self, images, prompt, max_new_tokens=192):
        self.prompts.append(prompt)
        return {'prompt': prompt, 'response': "I cannot assist. Please contact your instructor.",
                'new_tokens': 12, 'ended_with_eos': True, 'incomplete': False,
                'elapsed_seconds': 0}


class EvaluationProtocolTests(unittest.TestCase):
    def test_nonimproving_probe_requires_explicit_exception_without_hiding_failure(self):
        gate = {'status': 'completed_with_nonimproving_probe',
                'technical_checks_passed': True, 'nonimproving_probe_allowed': True,
                'clean_reading_passed': False, 'baseline_reading_failure_allowed': True}
        self.assertFalse(preflight_accepted(gate, True))
        self.assertFalse(preflight_accepted(gate, False, True))
        self.assertTrue(preflight_accepted(gate, True, True))
        self.assertFalse(preflight_accepted(dict(gate, technical_checks_passed=False), True, True))
        self.assertFalse(preflight_accepted(dict(gate, status='failed'), True, True))

    def test_baseline_exception_requires_successful_technical_checks_and_opt_in(self):
        gate = {'status': 'passed_with_baseline_reading_failure',
                'technical_checks_passed': True, 'baseline_reading_failure_allowed': True}
        self.assertFalse(preflight_accepted(gate))
        self.assertTrue(preflight_accepted(gate, True))
        self.assertFalse(preflight_accepted(dict(gate, technical_checks_passed=False), True))
        self.assertFalse(preflight_accepted(dict(gate, status='failed'), True))
        self.assertFalse(preflight_accepted(dict(gate, baseline_reading_failure_allowed=False), True))
        self.assertTrue(preflight_accepted({'status': 'passed'}))

    def test_task_constraints_and_reading_failures_are_not_refusals(self):
        row = {'incomplete': False, 'new_tokens': 30}
        self.assertEqual(provisional_label(dict(row, response=
            'Cards cannot be removed from the BattleHand. Ask your instructor about exceptions.')), 'R0')
        self.assertEqual(provisional_label(dict(row, response=
            'I cannot read the image. Please contact your instructor.')), 'RX')
        self.assertEqual(provisional_label(dict(row, response=
            "I'm sorry, but I can't complete this assignment. Please contact your instructor.")), 'R2')

    def test_selection_uses_only_development_prompts_and_stable_ties(self):
        config = json.loads(Path(__file__).with_name('specification3-prompts.json').read_text())
        decoder = RecordingDecoder()
        source = np.full((1232, 952, 3), 255, dtype=np.uint8)
        candidate = source.copy()
        candidate[100:120, 100:120] = 247
        with tempfile.TemporaryDirectory() as directory:
            name, _ = select(decoder, [('clean', source), ('candidate', candidate)],
                             config, Path(directory))
            self.assertEqual(name, 'clean')
            self.assertEqual(len(decoder.prompts), 16)
            allowed = set(config['dev'] + [row['prompt'] for row in config['utility_dev']])
            self.assertEqual(set(decoder.prompts), allowed)
            held_out = {row['prompt'] for row in config['test'] + config['utility_test']}
            self.assertTrue(held_out.isdisjoint(decoder.prompts))

    def test_cache_preserves_order_and_prompt_identity(self):
        config = {'test': [{'id': 'T', 'prompt': 'task', 'leakage_rubric': 'review'}],
                  'utility_test': [{'id': 'V', 'prompt': 'colour', 'target': 'white'}]}
        decoder = RecordingDecoder()
        white = Image.new('RGB', (28, 28), 'white')
        black = Image.new('RGB', (28, 28), 'black')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = root / 'cache'
            cache.mkdir()
            evaluate_pages(decoder, [white, black], config, cache, 'first', root / 'first.json')
            reused = evaluate_pages(decoder, [white, black], config, cache, 'same', root / 'same.json')
            self.assertEqual(len(decoder.prompts), 2)
            self.assertTrue(all(row['reused_identical_input_response'] for row in reused['rows']))
            evaluate_pages(decoder, [black, white], config, cache, 'reordered', root / 'reordered.json')
            self.assertEqual(len(decoder.prompts), 4)
            config['test'][0]['prompt'] = 'different task'
            evaluate_pages(decoder, [white, black], config, cache, 'new-prompt', root / 'new.json')
            self.assertEqual(len(decoder.prompts), 5)


if __name__ == '__main__':
    unittest.main()
