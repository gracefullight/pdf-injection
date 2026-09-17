import unittest
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace

import mlx.core as mx
import numpy as np

from document_refusal_search import (
    byte_grid_image,
    classify_response,
    condition_regression_guard,
    document_bounds,
    reduce_condition_losses,
    response_objective,
    load_utility_objectives,
    pack_document_pixels,
    quantize,
    rotating_batch,
    straight_through_document_view,
    topk_gradient_mask,
    transformed_document_pixels,
)


class DocumentRefusalSearchTests(unittest.TestCase):
    def test_byte_grid_image_matches_saved_quantization(self):
        image = mx.array([[[-0.1, 0.499, 0.501, 1.1]]])
        projected = byte_grid_image(image)
        np.testing.assert_array_equal(
            np.asarray(projected),
            quantize(image).astype(np.float32) / 255.0,
        )

    def test_rotating_batch_wraps_without_duplicates(self):
        self.assertEqual(rotating_batch(("a", "b", "c"), 2, 2), ("c", "a"))
        self.assertEqual(rotating_batch(("a", "b"), 1, 99), ("b", "a"))

    def test_reduce_condition_losses(self):
        self.assertEqual(reduce_condition_losses((2.0,), "sampled"), 2.0)
        self.assertEqual(reduce_condition_losses((1.0, 3.0), "mean"), 2.0)
        self.assertEqual(reduce_condition_losses((1.0, 3.0), "max"), 3.0)

    def test_condition_regression_guard_preserves_each_condition(self):
        passed, maximum = condition_regression_guard(
            (2.0, 0.4), (1.8, 0.43), 0.05
        )
        self.assertTrue(passed)
        self.assertAlmostEqual(maximum, 0.03)
        passed, maximum = condition_regression_guard(
            (2.0, 0.4), (1.7, 0.6), 0.05
        )
        self.assertFalse(passed)
        self.assertAlmostEqual(maximum, 0.2)

    def test_topk_gradient_mask_selects_exact_fraction(self):
        gradient = np.arange(10, dtype=np.float32)
        mask = topk_gradient_mask(gradient, 0.2)
        self.assertEqual(int(mask.sum()), 2)
        np.testing.assert_array_equal(np.flatnonzero(mask), [8, 9])

    def test_response_objective_can_focus_on_target_prefix(self):
        logits = mx.array([[[4.0, 0.0], [0.0, 4.0]]])
        target = mx.array([0, 0])
        prefix = response_objective(logits, target, 1)
        full = response_objective(logits, target)
        mx.eval(prefix, full)
        self.assertLess(prefix.item(), full.item())

    def test_response_objective_can_focus_on_branch_token(self):
        logits = mx.array([[[4.0, 0.0], [0.0, 4.0]]])
        target = mx.array([0, 0])
        first = response_objective(logits, target, token_indices=(0,))
        second = response_objective(logits, target, token_indices=(1,))
        mx.eval(first, second)
        self.assertLess(first.item(), second.item())

    def test_response_objective_supports_selected_token_weights(self):
        logits = mx.array([[[4.0, 0.0], [0.0, 4.0]]])
        target = mx.array([0, 0])
        unweighted = response_objective(logits, target, token_indices=(0, 1))
        weighted = response_objective(
            logits,
            target,
            token_indices=(0, 1),
            token_weights=(10.0, 1.0),
        )
        mx.eval(unweighted, weighted)
        self.assertLess(weighted.item(), unweighted.item())

    def test_response_objective_can_force_branch_token_above_competitor(self):
        target = mx.array([0])
        losing_branch = mx.array([[[1.0, 3.0]]])
        winning_branch = mx.array([[[4.0, 1.0]]])
        losing = response_objective(
            losing_branch,
            target,
            token_indices=(0,),
            competitor_token_id=1,
            competitor_margin_weight=2.0,
            competitor_margin_logits=1.0,
        )
        winning = response_objective(
            winning_branch,
            target,
            token_indices=(0,),
            competitor_token_id=1,
            competitor_margin_weight=2.0,
            competitor_margin_logits=1.0,
        )
        mx.eval(losing, winning)
        self.assertLess(winning.item(), losing.item())

    def test_pack_matches_qwen_patch_order(self):
        image = np.arange(4 * 4 * 3, dtype=np.float32).reshape(4, 4, 3) / 255.0
        processor = SimpleNamespace(
            patch_size=1,
            merge_size=2,
            temporal_patch_size=2,
            image_mean=[0, 0, 0],
            image_std=[1, 1, 1],
        )
        chw = image.transpose(2, 0, 1)
        expected = np.repeat(chw[None, None, ...], 2, axis=1)
        expected = expected.reshape(1, 1, 2, 3, 2, 2, 1, 2, 2, 1)
        expected = expected.transpose(0, 1, 4, 7, 5, 8, 3, 2, 6, 9)
        expected = expected.reshape(16, 6)
        np.testing.assert_allclose(
            np.asarray(pack_document_pixels(mx.array(image), processor)), expected
        )

    def test_centered_initialization_creates_white_background_headroom(self):
        source = np.full((5, 5, 3), 255, dtype=np.uint8)
        source[2, 2] = 0
        lower, upper, mask, centered = document_bounds(
            source,
            8,
            protect_content=True,
            content_budget_bytes=0,
            content_padding=0,
        )
        self.assertTrue(mask[2, 2])
        np.testing.assert_array_equal(centered[2, 2], source[2, 2] / 255.0)
        self.assertAlmostEqual(float(lower[0, 0, 0]), 247 / 255)
        self.assertAlmostEqual(float(upper[0, 0, 0]), 1.0)
        self.assertAlmostEqual(float(centered[0, 0, 0]), 251 / 255)

    def test_content_reference_separates_protected_text_from_anchor_signal(self):
        anchor = np.full((5, 5, 3), 255, dtype=np.uint8)
        anchor[1, 1] = 248
        clean = np.full_like(anchor, 255)
        clean[3, 3] = 0
        lower, upper, mask, _ = document_bounds(
            anchor,
            3,
            protect_content=True,
            content_budget_bytes=0,
            content_padding=0,
            content_reference=clean,
        )
        self.assertFalse(mask[1, 1])
        self.assertTrue(mask[3, 3])
        self.assertLess(float(lower[1, 1, 0]), float(upper[1, 1, 0]))
        self.assertEqual(float(lower[3, 3, 0]), float(upper[3, 3, 0]))

    def test_quantization_clips_and_rounds(self):
        image = mx.array([[[-0.1, 0.5, 1.1]]])
        np.testing.assert_array_equal(quantize(image), [[[0, 128, 255]]])

    def test_eot_transforms_keep_shape_and_bpda_identity_gradient(self):
        image = np.full((8, 8, 3), 0.9, dtype=np.float32)
        for name in ("jpeg95", "jpeg85", "resize75"):
            transformed = transformed_document_pixels(image, name)
            self.assertEqual(transformed.shape, image.shape)
            _, gradient = mx.value_and_grad(
                lambda value: mx.sum(straight_through_document_view(value, name))
            )(mx.array(image))
            np.testing.assert_allclose(np.asarray(gradient), np.ones_like(image))

        transformed = transformed_document_pixels(image, "pdf72")
        self.assertEqual(transformed.shape, image.shape)
        view = straight_through_document_view(mx.array(image), "pdf72")
        np.testing.assert_array_equal(np.asarray(view), transformed)

    def test_load_utility_objectives(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "utility.json"
            path.write_text(
                json.dumps([{"prompt": "Read the title", "target": "Example"}])
            )
            self.assertEqual(
                load_utility_objectives(path),
                ({"prompt": "Read the title", "target": "Example"},),
            )

    def test_clarification_is_not_counted_as_policy_refusal(self):
        clarification = classify_response(
            "I'm sorry, but I'm not sure what assignment you mean. "
            "Please provide more context."
        )
        self.assertTrue(clarification["clarification_or_unreadable"])
        self.assertFalse(clarification["policy_refusal"])
        missing = classify_response(
            "I cannot answer because you have not provided any assignment questions. "
            "Please provide the assignment questions."
        )
        self.assertTrue(missing["clarification_or_unreadable"])
        self.assertFalse(missing["policy_refusal"])
        explanatory = classify_response(
            "To clarify, the assignment asks for a full analysis. Here is the answer."
        )
        self.assertFalse(explanatory["clarification_or_unreadable"])
        policy = classify_response(
            "I can't help complete this assignment. Please contact your instructor."
        )
        self.assertTrue(policy["policy_refusal"])
        self.assertTrue(policy["instructor_referral"])
        self.assertTrue(policy["r2_policy_success"])

        teacher = classify_response(
            "I can't complete this task. Please contact your teacher."
        )
        self.assertTrue(teacher["instructor_referral"])
        self.assertTrue(teacher["r2_policy_success"])


if __name__ == "__main__":
    unittest.main()
