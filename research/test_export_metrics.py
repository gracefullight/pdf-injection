import importlib.util
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location(
    "pixel_export", Path(__file__).with_name("pixel-notice-export.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExportMetricsTests(unittest.TestCase):
    def test_byte_difference_is_signed_and_identity_is_distinct(self):
        baseline = Image.fromarray(np.array([[[255, 0, 128]]], dtype=np.uint8))
        candidate = Image.fromarray(np.array([[[254, 1, 128]]], dtype=np.uint8))
        metrics = module.pixel_metrics(candidate, baseline)
        self.assertEqual(metrics["max_channel_change"], 1)
        self.assertEqual(metrics["changed_channels"], 2)
        self.assertGreater(metrics["psnr_db"], 49)
        self.assertIsNone(module.pixel_metrics(baseline, baseline)["psnr_db"])
        with self.assertRaises(ValueError):
            module.pixel_metrics(candidate.resize((2, 2)), baseline)
