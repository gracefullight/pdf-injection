import unittest
from pathlib import Path

import numpy as np

from make_factorial_raster_policy_pdf import add_notice, notice_mask


class FactorialRasterPolicyTests(unittest.TestCase):
    def test_notice_pixels_use_fixed_bitmap_contrast(self):
        mask = np.array([[0, 255]], dtype=np.uint8)
        image = np.full((1, 2, 3), 255, dtype=np.uint8)
        actual = add_notice(image, mask, 8)
        np.testing.assert_array_equal(actual[0, 0], [255, 255, 255])
        np.testing.assert_array_equal(actual[0, 1], [247, 247, 247])

    def test_visible_control_can_reach_black(self):
        mask = np.array([[255]], dtype=np.uint8)
        image = np.full((1, 1, 3), 255, dtype=np.uint8)
        actual = add_notice(image, mask, 255)
        np.testing.assert_array_equal(actual[0, 0], [0, 0, 0])

    def test_notice_mask_fits_expected_page(self):
        mask = notice_mask(
            (448, 560), Path("/System/Library/Fonts/Supplemental")
        )
        self.assertEqual(mask.shape, (560, 448))
        self.assertGreater(np.count_nonzero(mask), 0)

    def test_large_formal_notice_uses_more_raster_ink(self):
        font_dir = Path("/System/Library/Fonts/Supplemental")
        formal = notice_mask((448, 560), font_dir, "formal")
        large = notice_mask((448, 560), font_dir, "large-formal")
        self.assertGreater(np.count_nonzero(large), np.count_nonzero(formal))


if __name__ == "__main__":
    unittest.main()
