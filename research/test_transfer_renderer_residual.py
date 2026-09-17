import unittest

import numpy as np

from transfer_renderer_residual import residual_transfer


class RendererResidualTransferTests(unittest.TestCase):
    def test_transfer_obeys_budget_and_protected_mask(self):
        anchor = np.full((2, 2, 3), 250, dtype=np.uint8)
        base = np.full_like(anchor, 248)
        rendered_base = np.full_like(anchor, 240)
        rendered_target = np.full_like(anchor, 255)
        protected = np.array([[True, False], [False, False]])
        candidate = residual_transfer(
            anchor,
            base,
            rendered_base,
            rendered_target,
            scale=2,
            epsilon_bytes=4,
            protected=protected,
        )
        np.testing.assert_array_equal(candidate[0, 0], base[0, 0])
        self.assertLessEqual(int(np.max(np.abs(candidate.astype(int) - anchor))), 4)


if __name__ == "__main__":
    unittest.main()
