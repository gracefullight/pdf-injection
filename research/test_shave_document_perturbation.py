import unittest

import numpy as np

from shave_document_perturbation import image_metrics, scaled_candidate


class PerturbationShavingTests(unittest.TestCase):
    def test_scales_integer_budget_and_preserves_zero_delta(self):
        original = np.array([[[100, 100, 100], [250, 5, 128]]], dtype=np.uint8)
        candidate = np.array([[[108, 96, 100], [242, 13, 126]]], dtype=np.uint8)
        scaled = scaled_candidate(original, candidate, 4)
        np.testing.assert_array_equal(
            scaled, [[[104, 98, 100], [246, 9, 127]]]
        )
        self.assertEqual(image_metrics(original, scaled)["max_channel_change"], 4)

    def test_zero_budget_returns_original(self):
        original = np.full((2, 2, 3), 127, dtype=np.uint8)
        candidate = original.copy()
        candidate[0, 0, 0] = 135
        np.testing.assert_array_equal(
            scaled_candidate(original, candidate, 0), original
        )

    def test_rejects_out_of_range_budget(self):
        original = np.zeros((1, 1, 3), dtype=np.uint8)
        candidate = np.full((1, 1, 3), 8, dtype=np.uint8)
        with self.assertRaises(ValueError):
            scaled_candidate(original, candidate, 9)


if __name__ == "__main__":
    unittest.main()
