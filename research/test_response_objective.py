import importlib.util
import unittest
from pathlib import Path

import mlx.core as mx
import numpy as np
from mlx import nn

spec = importlib.util.spec_from_file_location(
    "response_gradient", Path(__file__).with_name("pixel-notice-response-gradient.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ResponseObjectiveTests(unittest.TestCase):
    def test_prefix_ignores_later_logits_but_full_loss_does_not(self):
        target = mx.array([0, 1, 2])
        logits = mx.zeros((1, 3, 4))
        changed = mx.array([[[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 8, 0]]])
        self.assertEqual(
            module.response_objective(logits, target, 2).item(),
            module.response_objective(changed, target, 2).item(),
        )
        self.assertGreater(
            module.response_objective(logits, target).item(),
            module.response_objective(changed, target).item(),
        )
        expected = nn.losses.cross_entropy(changed, target[None, :], reduction="mean")
        self.assertEqual(
            module.response_objective(changed, target).item(), expected.item()
        )
        self.assertEqual(
            module.response_objective(changed, target, 3).item(), expected.item()
        )

    def test_prefix_gradient_and_invalid_lengths(self):
        target = mx.array([0, 1, 2])
        logits = mx.zeros((1, 3, 4))
        gradient = mx.grad(lambda x: module.response_objective(x, target, 2))(logits)
        np.testing.assert_array_equal(np.asarray(gradient[:, 2:, :]), 0)
        self.assertGreater(float(mx.max(mx.abs(gradient[:, :2, :])).item()), 0)
        for invalid in (-1, 4):
            with self.assertRaises(ValueError):
                module.response_objective(logits, target, invalid)


if __name__ == "__main__":
    unittest.main()
