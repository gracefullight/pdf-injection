"""Check that the new reference preserves sub-ULP signals and derivatives."""
import unittest
from types import SimpleNamespace
import numpy as np
import torch
from diagnose_full_precision import exact_pair, native_vision_rotation, fixed_vision_frequencies, STEPS
from diagnose_downstream import native_rms_forward


class ReferenceTests(unittest.TestCase):
    def test_sub_fp32_ulp_displacements(self):
        base = np.array([.75, .875], dtype=np.float32)
        direction = np.array([1., -1.], dtype=np.float32)
        for step in STEPS:
            plus, minus = exact_pair(base, direction, step)
            np.testing.assert_array_equal((plus - minus) / (2 * step), direction)
        self.assertTrue(np.array_equal((base.astype(np.float64) + STEPS[0]).astype(np.float32), base))

    def test_rotation_preserves_double_signal_and_gradient(self):
        q = torch.tensor([[[.75 + 2**-30, .5]]], dtype=torch.float64, requires_grad=True)
        k = q.detach().clone()
        cos, sin = torch.ones(1, 2), torch.zeros(1, 2)
        out, _ = native_vision_rotation(q, k, cos, sin)
        self.assertTrue(torch.equal(out, q))
        self.assertFalse(torch.equal(out, q.float().double()))
        torch.testing.assert_close(torch.autograd.grad(out.sum(), q)[0], torch.ones_like(q))

    def test_rms_rotation_gradcheck(self):
        torch.manual_seed(7)
        module = SimpleNamespace(weight=torch.ones(4, dtype=torch.float64), variance_epsilon=1e-6)
        x = torch.randn(2, 1, 4, dtype=torch.float64, requires_grad=True)
        cos, sin = torch.randn(2, 4), torch.randn(2, 4)
        def function(value):
            rotated, _ = native_vision_rotation(value, value, cos, sin)
            return native_rms_forward(module, rotated)
        self.assertTrue(torch.autograd.gradcheck(function, (x,), eps=1e-6, atol=1e-6))

    def test_fixed_position_constants(self):
        freq = torch.tensor([.1, .03], dtype=torch.float32)
        module = SimpleNamespace(inv_freq=freq.double())
        expected = torch.outer(torch.arange(9, dtype=torch.float32), freq)
        self.assertTrue(torch.equal(fixed_vision_frequencies(module, 9), expected))


if __name__ == '__main__':
    unittest.main()
