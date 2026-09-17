import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace

import mlx.core as mx
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location(
    "response_gradient", Path(__file__).with_name("pixel-notice-response-gradient.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PixelStepTests(unittest.TestCase):
    def test_content_budget_is_cumulative_and_separate_from_background(self):
        anchor = np.full((2, 2, 3), 128, dtype=np.uint8)
        mask = np.array([[True, False], [False, False]])
        first = module.project_step(
            anchor, np.ones_like(anchor), 2, anchor, mask, protected_budget=1
        )
        second = module.project_step(
            first, np.ones_like(anchor), 4, anchor, mask, protected_budget=1
        )
        np.testing.assert_array_equal(second[mask], 127)
        np.testing.assert_array_equal(second[~mask], 124)
        with self.assertRaises(ValueError):
            module.project_step(
                anchor - 2, np.ones_like(anchor), 1, anchor, mask, protected_budget=1
            )

    def test_content_and_neighborhood_are_frozen(self):
        original = np.full((17, 17, 3), 255, dtype=np.uint8)
        original[8, 8] = 0
        mask = module.content_mask(Image.fromarray(original))
        self.assertEqual(int(mask.sum()), 15 * 15)
        projected = module.project_step(
            original, np.ones_like(original), 4, original, mask
        )
        np.testing.assert_array_equal(projected[mask], original[mask])
        self.assertEqual(int(projected[0, 0, 0]), 251)
        changed_content = original.copy()
        changed_content[8, 8] = 1
        with self.assertRaises(ValueError):
            module.project_step(
                changed_content, np.ones_like(original), 1, original, mask
            )

    def test_projection_preserves_cumulative_budget_across_steps(self):
        anchor = np.array([[[128, 128, 128]]], dtype=np.uint8)
        direction = np.array([[[-1, 1, 0]]], dtype=np.float32)
        first = module.project_step(anchor, direction, 2, anchor)
        second = module.project_step(first, direction, 4, anchor)
        np.testing.assert_array_equal(second, [[[132, 124, 128]]])
        with self.assertRaises(ValueError):
            module.project_step(anchor + 5, direction, 1, anchor)
        with self.assertRaises(ValueError):
            module.project_step(anchor, np.full_like(direction, np.nan), 1, anchor)

    def test_saved_pattern_scaling_clips_without_uint8_wraparound(self):
        source = Image.fromarray(np.array([[[255, 0, 128]]], dtype=np.uint8))
        candidate = Image.fromarray(np.array([[[254, 1, 129]]], dtype=np.uint8))
        positive = module.scale_saved_pattern(source, candidate, 4)
        negative = module.scale_saved_pattern(source, candidate, -4)
        np.testing.assert_array_equal(np.asarray(positive), [[[251, 4, 132]]])
        np.testing.assert_array_equal(np.asarray(negative), [[[255, 0, 124]]])
        with self.assertRaises(ValueError):
            module.scale_saved_pattern(source, positive, 1)

    def test_patch_order_and_one_channel_bound(self):
        rgb = np.array(
            [
                [[1, -1], [0, 1]],
                [[-1, 0], [1, -1]],
                [[0, 1], [-1, 0]],
            ],
            dtype=np.float32,
        )
        temporal = np.stack([rgb / 2, rgb / 2])
        packed = temporal.reshape(1, 1, 2, 3, 1, 2, 1, 1, 2, 1)
        packed = packed.transpose(0, 1, 4, 7, 5, 8, 3, 2, 6, 9).reshape(4, 6)
        processor = SimpleNamespace(
            image_processor=SimpleNamespace(
                patch_size=1,
                merge_size=2,
                temporal_patch_size=2,
                image_std=[1, 1, 1],
            )
        )
        source = Image.fromarray(np.full((2, 2, 3), 128, dtype=np.uint8))
        actual = module.pixel_step(
            source, mx.array(packed), mx.array([[1, 2, 2]]), processor
        )
        expected = 128 - np.sign(rgb.transpose(1, 2, 0))
        np.testing.assert_array_equal(np.asarray(actual), expected)
        # For a 2x2 page the unquantized renderer is A @ channel @ A.T.
        a = np.array([[1, 0], [1 / 3, 2 / 3]])
        pulled_back = np.stack([a.T @ channel @ a for channel in rgb], axis=-1)
        rendered_step = module.pixel_step(
            source,
            mx.array(packed),
            mx.array([[1, 2, 2]]),
            processor,
            renderer_adjoint=True,
            step=4,
        )
        np.testing.assert_array_equal(
            np.asarray(rendered_step), 128 - 4 * np.sign(pulled_back)
        )


if __name__ == "__main__":
    unittest.main()
