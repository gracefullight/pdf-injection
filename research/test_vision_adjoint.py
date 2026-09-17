import unittest

import mlx.core as mx
from mlx import nn
from pixel_notice_vision import layerwise_vision_vjp


class TestBlock(nn.Module):
    def __init__(self):
        super().__init__()
        self.linear = nn.Linear(8, 8)

    def __call__(self, x, marker=None):
        return x + mx.tanh(self.linear(x))


class TestMerger(nn.Module):
    def __init__(self):
        super().__init__()
        self.linear = nn.Linear(16, 4)

    def __call__(self, x):
        return self.linear(x.reshape(2, 16))


class TestTower(nn.Module):
    spatial_merge_unit = 2

    def __init__(self):
        super().__init__()
        self.patch_embed = nn.Linear(6, 8)
        self.blocks = [TestBlock() for _ in range(3)]
        self.merger = TestMerger()

    def get_window_index(self, grid):
        return mx.array([1, 0]), None

    def __call__(self, pixels, grid, output_hidden_states=False):
        order, _ = self.get_window_index(grid)
        hidden = self.patch_embed(pixels).reshape(2, 2, 8)[order].reshape(4, 8)
        for block in self.blocks:
            hidden = block(hidden, marker=0)
        return self.merger(hidden)[mx.argsort(order)]


class VisionAdjointTests(unittest.TestCase):
    def test_chain_rule_and_original_block_restoration(self):
        mx.random.seed(17)
        tower = TestTower()
        tower.freeze()
        blocks = tower.blocks
        grid = mx.array([[1, 2, 2]])
        pixels = mx.random.normal((4, 6))
        cotangent = mx.random.normal((2, 4))
        _, (reference,) = mx.vjp(lambda x: tower(x, grid), [pixels], [cotangent])
        actual = layerwise_vision_vjp(tower, grid, pixels, cotangent)
        self.assertTrue(mx.allclose(reference, actual, atol=1e-5, rtol=1e-5).item())
        self.assertIs(tower.blocks, blocks)


if __name__ == "__main__":
    unittest.main()
