import unittest

import numpy as np
import torch

from diagnose_path import BoundaryCapture, boundary_comparison, projection
from diagnostic_checkpoint import checkpoint_block
from math_optimizer import math_contexts


class PathDiagnosticTests(unittest.TestCase):
    def test_outer_boundaries_survive_checkpoint_recomputation_and_modes(self):
        block = torch.nn.Sequential(torch.nn.Linear(3, 3, bias=False), torch.nn.Tanh()).double().eval()
        block.requires_grad_(False)
        checkpoint_block(block[1], context_fn=math_contexts)
        capture = BoundaryCapture({'outer': block})
        x = torch.tensor([[.2, -.1, .3]], dtype=torch.float64, requires_grad=True)
        capture.capture_gradients = True
        y = block(x)
        y.square().sum().backward()
        np.testing.assert_allclose(capture.gradients['outer'], 2 * y.detach().numpy(), rtol=1e-6)
        saved_gradient = capture.gradients['outer'].copy()
        capture.capture_gradients = False
        for enabled in (False, True):
            with torch.set_grad_enabled(enabled):
                actual = block(x.detach().requires_grad_(enabled))
            np.testing.assert_allclose(capture.values['outer'], actual.detach().numpy(), rtol=1e-6)
            np.testing.assert_array_equal(capture.gradients['outer'], saved_gradient)
        capture.close()
        self.assertFalse(block._forward_hooks)

    def test_boundary_projection_uses_difference_before_dot(self):
        gradient = np.array([2., -3.])
        direction = np.array([1., -2.])
        base = np.array([.5, .75], dtype=np.float32)
        step = 2. ** -20
        analytic = projection(gradient, direction)
        row = boundary_comparison(gradient, base + step * direction,
                                  base - step * direction, step, analytic)
        self.assertEqual(row['projected_finite_difference'], 8.)
        self.assertEqual(row['relative_error'], 0.)
        self.assertEqual(row['changed_elements'], 2)


if __name__ == '__main__':
    unittest.main()
