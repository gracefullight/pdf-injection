import unittest
from types import SimpleNamespace

import mlx.core as mx
import numpy as np
from mlx import nn
from pixel_notice_language import language_input_vjp


class Block(nn.Module):
    def __init__(self, scale):
        super().__init__()
        self.scale = scale

    def __call__(self, x, mask=None):
        return mx.tanh(x * self.scale) + x / 4


class Language(nn.Module):
    def __init__(self):
        super().__init__()
        self.model = nn.Module()
        self.model.layers = [Block(0.7), Block(1.2), Block(0.9)]
        self.model.norm = nn.RMSNorm(3)
        self.lm_head = nn.Linear(3, 5, bias=False)
        self.args = SimpleNamespace(tie_word_embeddings=False)

    def __call__(self, ids, inputs_embeds):
        x = inputs_embeds
        for block in self.model.layers:
            x = block(x, mask=None)
        return SimpleNamespace(logits=self.lm_head(self.model.norm(x)))


class LanguageAdjointTests(unittest.TestCase):
    def test_layerwise_matches_full_autodiff_and_restores_layers(self):
        mx.random.seed(41)
        language = Language()
        original = language.model.layers
        x = mx.random.normal((1, 4, 3))
        ids = mx.zeros((1, 4), dtype=mx.int32)
        criterion = lambda logits: mx.mean(logits**2)
        expected_value, expected_gradient = mx.value_and_grad(
            lambda h: criterion(language(ids, inputs_embeds=h).logits)
        )(x)
        value, gradient = language_input_vjp(
            language, ids, {"inputs_embeds": x}, criterion
        )
        self.assertIs(language.model.layers, original)
        self.assertAlmostEqual(value.item(), expected_value.item(), places=6)
        np.testing.assert_allclose(
            np.asarray(gradient), np.asarray(expected_gradient), rtol=1e-5, atol=1e-6
        )

    def test_forward_failure_restores_layers(self):
        language = Language()
        original = language.model.layers

        def failure(logits):
            raise ValueError("test criterion failure")

        with self.assertRaisesRegex(ValueError, "test criterion failure"):
            language_input_vjp(
                language,
                mx.zeros((1, 2), dtype=mx.int32),
                {"inputs_embeds": mx.ones((1, 2, 3))},
                failure,
            )
        self.assertIs(language.model.layers, original)


if __name__ == "__main__":
    unittest.main()
