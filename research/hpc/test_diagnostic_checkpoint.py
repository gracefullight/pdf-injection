import copy
import unittest

import torch

from diagnostic_checkpoint import checkpoint_block


class DiagnosticCheckpointTests(unittest.TestCase):
    def test_frozen_eval_outputs_and_input_gradients_match(self):
        torch.manual_seed(17)
        plain = torch.nn.Sequential(torch.nn.Linear(5, 7), torch.nn.GELU(),
                                    torch.nn.Dropout(.5), torch.nn.Linear(7, 3)).double().eval()
        plain.requires_grad_(False)
        recomputed = copy.deepcopy(plain)
        for block in recomputed:
            checkpoint_block(block)
        source = torch.randn(4, 5, dtype=torch.float64)
        x = source.clone().requires_grad_()
        y = source.clone().requires_grad_()
        expected, actual = plain(x), recomputed(y)
        torch.testing.assert_close(actual, expected, rtol=0, atol=0)
        dx = torch.autograd.grad(expected.square().sum(), x)[0]
        dy = torch.autograd.grad(actual.square().sum(), y)[0]
        torch.testing.assert_close(dy, dx, rtol=0, atol=0)
        self.assertTrue(all(not m.training for m in recomputed.modules()))
        self.assertTrue(all(p.grad is None for p in recomputed.parameters()))
        with torch.no_grad():
            torch.testing.assert_close(recomputed(source), plain(source), rtol=0, atol=0)


if __name__ == '__main__':
    unittest.main()
