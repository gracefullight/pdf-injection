import unittest

import mlx.core as mx
from pixel_notice_attention import row_chunked_attention


class AttentionAdjointTests(unittest.TestCase):
    def test_forward_and_first_derivatives(self):
        original = mx.fast.scaled_dot_product_attention
        for dtype, tolerance in ((mx.float32, 1e-4), (mx.float16, 0.01)):
            with self.subTest(dtype=str(dtype)):
                mx.random.seed(17)
                values = [
                    mx.random.normal((1, 2, 193, 32)).astype(dtype) for _ in range(3)
                ]
                cotangent = mx.random.normal(values[0].shape).astype(dtype)
                base = lambda q, k, v: original(q, k, v, scale=32**-0.5, mask=None)
                chunked = lambda q, k, v: row_chunked_attention(
                    original, q, k, v, 32**-0.5, chunk_size=64
                )
                expected, expected_grad = mx.vjp(base, values, [cotangent])
                actual, actual_grad = mx.vjp(chunked, values, [cotangent])
                self.assertTrue(mx.array_equal(expected[0], actual[0]).item())
                for reference, candidate in zip(expected_grad, actual_grad):
                    difference = mx.max(
                        mx.abs(
                            reference.astype(mx.float32) - candidate.astype(mx.float32)
                        )
                    )
                    relative = difference / mx.max(mx.abs(reference))
                    self.assertLess(relative.item(), tolerance)
                    self.assertTrue(mx.all(mx.isfinite(candidate)).item())


if __name__ == "__main__":
    unittest.main()
