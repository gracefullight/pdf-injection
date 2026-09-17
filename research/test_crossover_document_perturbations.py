import unittest

import numpy as np

from crossover_document_perturbations import crossover, linear_mix


class CrossoverDocumentPerturbationTests(unittest.TestCase):
    def test_linear_mix_stays_between_candidates(self):
        first = np.zeros((2, 2, 3), dtype=np.uint8)
        second = np.full_like(first, 10)
        np.testing.assert_array_equal(linear_mix(first, second, 0.5), 5)

    def test_channel_crossover_only_uses_parent_values(self):
        first = np.zeros((8, 8, 3), dtype=np.uint8)
        second = np.full_like(first, 10)
        candidate = crossover(first, second, 0.5, seed=17)
        self.assertEqual(set(np.unique(candidate)), {0, 10})

    def test_patch_crossover_shares_mask_across_channels(self):
        first = np.zeros((8, 8, 3), dtype=np.uint8)
        second = np.full_like(first, 10)
        candidate = crossover(first, second, 0.5, seed=17, patch_size=4)
        np.testing.assert_array_equal(candidate[..., 0], candidate[..., 1])
        np.testing.assert_array_equal(candidate[..., 1], candidate[..., 2])


if __name__ == "__main__":
    unittest.main()
