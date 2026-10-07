"""Test paired policy-delivery inputs without model computation."""
import json
from pathlib import Path
import unittest

import numpy as np
from PIL import Image

from policy_delivery import cases, condition_images, question_prompt


class PolicyDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.pages = [Image.new('RGB', (28, 56), (i, 20, 40)) for i in range(7)]
        self.notice = Image.new('RGB', (28, 56), 'black')

    def test_inline_and_blank_keep_source_pixels_and_identical_geometry(self):
        for scope, index in [('single', 0), ('full', 1)]:
            for channel in ('inline_policy', 'inline_blank'):
                images = condition_images(self.pages, self.notice, scope, channel)
                self.assertEqual(images[index].size, (28, 112))
                np.testing.assert_array_equal(np.asarray(images[index])[56:], np.asarray(self.pages[1]))
                if scope == 'full':
                    for i in (0, 2, 3, 4, 5, 6):
                        np.testing.assert_array_equal(np.asarray(images[i]), np.asarray(self.pages[i]))

    def test_separate_controls_have_same_page_order(self):
        for scope in ('single', 'full'):
            policy = condition_images(self.pages, self.notice, scope, 'separate_policy')
            blank = condition_images(self.pages, self.notice, scope, 'separate_blank')
            self.assertEqual(len(policy), 2 if scope == 'single' else 8)
            for a, b in zip(policy[1:], blank[1:]):
                np.testing.assert_array_equal(np.asarray(a), np.asarray(b))

    def test_only_text_channel_adds_policy_to_user_prompt(self):
        policy = 'Original notice.\n\nSecond paragraph.'
        clean = question_prompt(policy, 'clean', 'exclusive', 'Question?')
        self.assertEqual(question_prompt(policy, 'text_policy', 'exclusive', 'Question?'), policy + '\n\n' + clean)
        self.assertEqual(question_prompt(policy, 'inline_policy', 'exclusive', 'Question?'), clean)

    def test_complete_paired_matrix_reuses_only_declared_diagnostic_questions(self):
        config = json.loads(Path(__file__).with_name('specification3-prompts.json').read_text())
        matrix = list(cases(config))
        self.assertEqual(len(matrix), 288)
        ids = [(a, b, c, q['id'], n) for a, b, c, q, n in matrix]
        self.assertEqual(len(set(ids)), 288)
        for a, b, c, q, n in ids:
            self.assertIn((a, b, c, q, 768 if n == 192 else 192), ids)


if __name__ == '__main__':
    unittest.main()
