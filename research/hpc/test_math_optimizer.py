import copy
import unittest

import torch

from diagnostic_checkpoint import checkpoint_block
from math_optimizer import math_contexts, math_loss, verify_math_gate, implementation_hashes


class AttentionBlock(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.backend_records = []

    def forward(self, value):
        self.backend_records.append((torch.backends.cuda.math_sdp_enabled(),
                                     torch.backends.cuda.flash_sdp_enabled(),
                                     torch.backends.cuda.mem_efficient_sdp_enabled()))
        return torch.nn.functional.scaled_dot_product_attention(value, value, value)


class MathOptimizerTests(unittest.TestCase):
    def test_math_context_survives_backward_outside_loss(self):
        block = AttentionBlock().eval()
        checkpoint_block(block, context_fn=math_contexts)
        flags = (torch.backends.cuda.math_sdp_enabled(), torch.backends.cuda.flash_sdp_enabled(),
                 torch.backends.cuda.mem_efficient_sdp_enabled())
        x = torch.randn(1, 2, 4, 3, dtype=torch.float64, requires_grad=True)
        actual = math_loss(block)(x)
        actual.square().sum().backward()
        self.assertGreaterEqual(len(block.backend_records), 2)
        self.assertTrue(all(row == (True, False, False) for row in block.backend_records))
        self.assertEqual(flags, (torch.backends.cuda.math_sdp_enabled(), torch.backends.cuda.flash_sdp_enabled(),
                                 torch.backends.cuda.mem_efficient_sdp_enabled()))
        y = x.detach().clone().requires_grad_()
        expected = math_loss(AttentionBlock().eval())(y)
        expected.square().sum().backward()
        torch.testing.assert_close(actual, expected, rtol=0, atol=0)
        torch.testing.assert_close(x.grad, y.grad, rtol=0, atol=0)

    def test_gate_rejects_backend_or_source_drift(self):
        good = {'optimizer_execution': {'backend': 'math', 'recompute_backend': 'math',
                                       'implementation_sha256': implementation_hashes()}}
        verify_math_gate(good)
        for field in ('backend', 'recompute_backend', 'implementation_sha256'):
            bad = copy.deepcopy(good)
            bad['optimizer_execution'][field] = 'changed'
            with self.assertRaisesRegex(RuntimeError, 'does not match'):
                verify_math_gate(bad)


if __name__ == '__main__':
    unittest.main()
