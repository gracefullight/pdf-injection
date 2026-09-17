import unittest

import numpy as np
from PIL import Image
from pixel_notice_render import input_vjp, interpolate, render


class RenderAdjointTests(unittest.TestCase):
    def test_continuous_interpolation_adjoint_inner_product(self):
        rng = np.random.default_rng(17)
        for shape in ((1, 1, 3), (3, 7, 3), (20, 16, 3)):
            with self.subTest(shape=shape):
                source = rng.normal(size=shape)
                cotangent = rng.normal(size=shape)
                forward_product = np.sum(
                    interpolate(source, quantize=False) * cotangent
                )
                backward_product = np.sum(source * input_vjp(cotangent))
                self.assertAlmostEqual(forward_product, backward_product, places=10)

    def test_quantization_is_part_of_forward_not_its_continuous_adjoint(self):
        source = np.array([[[0, 255, 0], [255, 0, 255]]], dtype=np.uint8)
        image = Image.fromarray(source)
        actual = np.asarray(render(image))
        np.testing.assert_array_equal(actual, [[[0, 255, 0], [170, 85, 170]]])
