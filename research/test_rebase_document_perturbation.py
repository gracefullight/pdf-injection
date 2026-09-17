import unittest

import numpy as np

from rebase_document_perturbation import rebase_candidate


class RebaseDocumentPerturbationTests(unittest.TestCase):
    def test_rebase_preserves_exact_integer_delta(self):
        reference = np.full((2, 2, 3), 200, dtype=np.uint8)
        candidate = reference.copy()
        candidate[0, 0] = [198, 201, 200]
        base = np.full_like(reference, 100)
        rebased = rebase_candidate(reference, candidate, base)
        np.testing.assert_array_equal(
            rebased.astype(np.int16) - base.astype(np.int16),
            candidate.astype(np.int16) - reference.astype(np.int16),
        )

    def test_rebase_rejects_clipping(self):
        reference = np.full((1, 1, 3), 100, dtype=np.uint8)
        candidate = np.full_like(reference, 90)
        base = np.full_like(reference, 5)
        with self.assertRaisesRegex(ValueError, "clip"):
            rebase_candidate(reference, candidate, base)


if __name__ == "__main__":
    unittest.main()
