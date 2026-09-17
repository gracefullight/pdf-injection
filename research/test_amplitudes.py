import importlib.util
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location(
    "amplitudes", Path(__file__).with_name("pixel-notice-amplitudes.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AmplitudeTests(unittest.TestCase):
    def test_positive_scaling_preserves_unchanged_pixels_and_clipping(self):
        source = Image.fromarray(np.array([[[255, 0, 128]]], dtype=np.uint8))
        pattern = Image.fromarray(np.array([[[254, 1, 128]]], dtype=np.uint8))
        actual = module.scale_positive_pattern(source, pattern, 64)
        np.testing.assert_array_equal(np.asarray(actual), [[[191, 64, 128]]])
        with self.assertRaises(ValueError):
            module.scale_positive_pattern(source, actual, 1)
        with self.assertRaises(ValueError):
            module.scale_positive_pattern(source, pattern, -1)
