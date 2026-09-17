import unittest

import numpy as np
from PIL import Image
from pixel_notice_resize import bicubic_input_vjp, require_bicubic_processor


class ResizeAdjointTests(unittest.TestCase):
    def test_installed_mlx_processor_uses_pillow_byte_bicubic(self):
        from mlx_vlm.models.qwen3_vl.processing_qwen3_vl import (
            Qwen3VLImageProcessor,
            _resize_video_frames,
        )

        require_bicubic_processor(Qwen3VLImageProcessor())
        with self.assertRaises(ValueError):
            require_bicubic_processor(object())
        rng = np.random.default_rng(37)
        x = rng.integers(0, 256, (7, 9, 3), dtype=np.uint8)
        actual = _resize_video_frames(x.transpose(2, 0, 1)[None], 11, 8)[0]
        expected = np.asarray(
            Image.fromarray(x).resize((8, 11), Image.Resampling.BICUBIC)
        )
        np.testing.assert_array_equal(actual.transpose(1, 2, 0), expected)

    def test_adjoint_matches_float_pillow_up_down_and_identity(self):
        rng = np.random.default_rng(29)
        for h, w, oh, ow in ((7, 9, 4, 6), (4, 6, 7, 9), (5, 5, 5, 5)):
            with self.subTest(shape=(h, w, oh, ow)):
                x = rng.normal(size=(h, w, 3)).astype(np.float32)
                g = rng.normal(size=(oh, ow, 3)).astype(np.float32)
                forward = np.stack(
                    [
                        np.asarray(
                            Image.fromarray(x[:, :, c]).resize(
                                (ow, oh), Image.Resampling.BICUBIC
                            )
                        )
                        for c in range(3)
                    ],
                    axis=-1,
                )
                backward = bicubic_input_vjp(g, (w, h))
                self.assertAlmostEqual(
                    float(np.sum(forward * g)), float(np.sum(x * backward)), places=5
                )

    def test_inverse_bilinear_resize_is_not_the_bicubic_adjoint(self):
        rng = np.random.default_rng(31)
        g = rng.normal(size=(11, 8, 3)).astype(np.float32)
        old = np.stack(
            [
                np.asarray(
                    Image.fromarray(g[:, :, c]).resize(
                        (9, 7), Image.Resampling.BILINEAR
                    )
                )
                for c in range(3)
            ],
            axis=-1,
        )
        corrected = bicubic_input_vjp(g, (9, 7))
        self.assertGreater(
            np.linalg.norm(old - corrected) / np.linalg.norm(corrected), 0.1
        )
        with self.assertRaises(ValueError):
            bicubic_input_vjp(g, (0, 7))


if __name__ == "__main__":
    unittest.main()
