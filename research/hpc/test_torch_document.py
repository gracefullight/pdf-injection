"""CPU tests of the port's processor parity, gradients and pixel constraints."""
import unittest

import numpy as np
from PIL import Image
import torch
from transformers import Qwen2VLImageProcessor

from torch_document import (bounds, exact_short_answer, metrics, pack_pixels,
                            quantize, transformed_input)


class DocumentInputTests(unittest.TestCase):
    def test_short_answer_rejects_negated_substrings(self):
        self.assertTrue(exact_short_answer('**Blue.**', 'Blue'))
        self.assertFalse(exact_short_answer('Not blue.', 'Blue'))
        self.assertFalse(exact_short_answer('No, it is white.', 'No'))

    def test_packing_matches_reference_and_backpropagates(self):
        processor = Qwen2VLImageProcessor(min_pixels=28 * 28, max_pixels=2048 * 2048)
        source = np.random.default_rng(17).integers(0, 256, (56, 84, 3), dtype=np.uint8)
        image = torch.tensor(source.astype(np.float32) / 255, requires_grad=True)
        packed = pack_pixels(image, processor)
        expected = processor(images=[Image.fromarray(source)], return_tensors='pt')['pixel_values']
        torch.testing.assert_close(packed, expected, rtol=0, atol=1e-6)
        packed.sum().backward()
        expected_grad = torch.tensor(2 / np.array(processor.image_std), dtype=torch.float32)
        torch.testing.assert_close(image.grad, expected_grad.expand_as(image))

    def test_geometry_rejects_implicit_resize(self):
        with self.assertRaises(ValueError):
            pack_pixels(torch.zeros(55, 84, 3), Qwen2VLImageProcessor())

    def test_constraints_protect_ink_and_its_margin(self):
        source = np.full((28, 28, 3), 255, dtype=np.uint8)
        source[14, 14] = 0
        lower, upper, protected = bounds(source, epsilon=8, padding=2)
        self.assertEqual(int(protected.sum()), 25)
        for candidate in (quantize(lower), quantize(upper)):
            result = metrics(source, candidate, protected)
            self.assertLessEqual(result['linf_bytes'], 8)
            self.assertEqual(result['protected_changed_channels'], 0)

    def test_bpda_has_real_byte_forward_and_identity_backward(self):
        source = np.random.default_rng(29).random((56, 84, 3), dtype=np.float32)
        for name in ('identity', 'jpeg95', 'jpeg85', 'resize75'):
            image = torch.tensor(source, requires_grad=True)
            transformed = transformed_input(image, name)
            self.assertEqual(transformed.shape, image.shape)
            torch.testing.assert_close(transformed * 255, (transformed * 255).round(),
                                       rtol=0, atol=2e-5)
            transformed.sum().backward()
            torch.testing.assert_close(image.grad, torch.ones_like(image))


if __name__ == '__main__':
    unittest.main()
