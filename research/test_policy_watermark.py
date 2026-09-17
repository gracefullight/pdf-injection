from __future__ import annotations

import unittest

from PIL import Image

from policy_watermark import detect_page, embed_page


class PolicyWatermarkTest(unittest.TestCase):
    def setUp(self) -> None:
        self.image = Image.new("RGB", (320, 240), "white")

    def tearDown(self) -> None:
        self.image.close()

    def test_matching_key_detects_text_free_marker(self) -> None:
        marked, changed = embed_page(
            self.image,
            key="correct-key",
            policy_id="uts-ai-prohibited-v1",
            page_index=0,
            delta=8,
            block_pixels=10,
            white_threshold=245,
        )
        try:
            result = detect_page(
                marked,
                key="correct-key",
                policy_id="uts-ai-prohibited-v1",
                page_index=0,
                block_pixels=10,
                white_threshold=235,
            )
        finally:
            marked.close()
        self.assertGreater(changed, 20_000)
        self.assertGreater(result.score, 7.0)

    def test_wrong_key_and_original_are_negative(self) -> None:
        marked, _ = embed_page(
            self.image,
            key="correct-key",
            policy_id="uts-ai-prohibited-v1",
            page_index=0,
            delta=8,
            block_pixels=10,
            white_threshold=245,
        )
        try:
            wrong = detect_page(
                marked,
                key="wrong-key",
                policy_id="uts-ai-prohibited-v1",
                page_index=0,
                block_pixels=10,
                white_threshold=235,
            )
            original = detect_page(
                self.image,
                key="correct-key",
                policy_id="uts-ai-prohibited-v1",
                page_index=0,
                block_pixels=10,
                white_threshold=235,
            )
        finally:
            marked.close()
        self.assertLess(abs(wrong.score), 0.5)
        self.assertEqual(original.score, 0.0)


if __name__ == "__main__":
    unittest.main()
