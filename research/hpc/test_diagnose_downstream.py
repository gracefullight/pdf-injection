from types import SimpleNamespace
import unittest

import torch

from diagnose_downstream import native_rms_forward, compare_pair, displacement_record, reduction_gradients


class DownstreamDiagnosticTests(unittest.TestCase):
    def test_both_loss_reductions_with_single_use_checkpoint_contexts(self):
        import copy
        from diagnostic_checkpoint import checkpoint_block
        from math_optimizer import math_contexts, math_loss
        torch.manual_seed(17)
        plain = torch.nn.Sequential(torch.nn.Linear(4, 6), torch.nn.GELU(),
                                    torch.nn.Linear(6, 3)).double().eval()
        plain.requires_grad_(False)
        wrapped = copy.deepcopy(plain)
        for block in wrapped:
            checkpoint_block(block, context_fn=math_contexts)
        value = torch.randn(2, 4, dtype=torch.float64, requires_grad=True)
        target = torch.tensor([0, 2])
        def criterion(logits, dtype):
            return torch.nn.functional.cross_entropy(logits.to(dtype), target)
        logits, loss, g32, g64 = reduction_gradients(math_loss(wrapped), value, criterion)
        for dtype, actual in ((torch.float32, g32), (torch.float64, g64)):
            expected = torch.autograd.grad(criterion(plain(value), dtype), value)[0]
            torch.testing.assert_close(actual, expected, rtol=0, atol=0)
        torch.testing.assert_close(logits, plain(value), rtol=0, atol=0)
        self.assertEqual(loss.dtype, torch.float64)
        self.assertTrue(all(p.grad is None for p in wrapped.parameters()))

    def test_rms_keeps_double_precision_and_matches_directional_derivative(self):
        module = SimpleNamespace(weight=torch.tensor([1., 1.5, .7], dtype=torch.float64),
                                 variance_epsilon=1e-6)
        value = torch.tensor([[.23, -.57, .81]], dtype=torch.float64, requires_grad=True)
        direction = torch.tensor([[.3, .2, -.1]], dtype=torch.float64)
        result = native_rms_forward(module, value)
        self.assertEqual(result.dtype, torch.float64)
        loss = result.square().sum()
        gradient = torch.autograd.grad(loss, value)[0]
        step = 1e-5
        plus, minus = value.detach() + step * direction, value.detach() - step * direction
        row = compare_pair(gradient, direction, plus, minus,
                           float(native_rms_forward(module, plus).square().sum()),
                           float(native_rms_forward(module, minus).square().sum()), step)
        self.assertLess(row['nominal']['relative_error'], 1e-7)

    def test_realized_projection_exposes_rounded_away_embedding_steps(self):
        base = torch.tensor([1e8, 1.], dtype=torch.float32)
        vector = torch.tensor([1., 1.], dtype=torch.float32)
        plus, minus = base + vector, base - vector
        gradient = torch.ones_like(base)
        # Accumulate this linear test loss in double to isolate input rounding.
        row = compare_pair(gradient, vector, plus, minus,
                           float(plus.double().sum()), float(minus.double().sum()), 1.)
        self.assertFalse(row['nominal']['agrees'])
        self.assertTrue(row['realized_displacement']['agrees'])
        rounding = displacement_record(base, vector, plus, minus, 1.)
        self.assertEqual(rounding['plus_changed_elements'], 1)
        self.assertGreater(rounding['plus_rounding_relative_l2'], .7)


if __name__ == '__main__':
    unittest.main()
