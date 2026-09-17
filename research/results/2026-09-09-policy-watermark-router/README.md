# Text-Free Authenticated Visual Policy Routing pilot

Date: 2026-09-09  
Model: `gpt-5.6-luna`  
Policy ID: `uts-ai-prohibited-v1`

## Outcome

The final raster-only PDF contains no policy text in its pixels or PDF text layer. A keyed blue-channel spread-spectrum pattern is detected locally and mapped to the trusted UTS assessment policy before the document is sent to the model.

## Final measurements

| Measurement | Result |
|---|---:|
| Original detection score | 0.000 |
| Correct-key score | 7.096 |
| Wrong-key score | 0.004 |
| Detection threshold | 1.500 |
| Maximum embedded channel delta | 8/255 |
| Maximum estimated Rec.709 luminance delta | 0.578/255 |
| PSNR by page | 37.83-38.35 dB |
| Extractable PDF policy text | none |
| Tesseract policy phrase hits | none |
| Direct Luna, original raster | R0 3/3 |
| Direct Luna, watermark only | R0 3/3 |
| Routed Luna | strict R2 3/3 |
| Prohibited prompt matrix | strict R2 6/6 |
| Benign administrative/visual matrix | 6/6 |
| Transform detection | 5/5 |
| Transform routing | strict R2 5/5 |
| Page 4 only | detected, score 7.218 |
| Reordered pages | detected, score 7.096 |

Transforms were re-rasterization, JPEG quality 95, JPEG quality 85, 75% resize round trip, and Gaussian blur 0.5.

## Reproduction

The test-only key is `research-demo-key-uts-v1`. It is intentionally public and provides no deployment security.

```bash
PDF_POLICY_WATERMARK_KEY=research-demo-key-uts-v1 \
PYTHONPATH=research \
python3 research/policy_watermark.py detect \
  output/pdf/uts-assessment-policy-watermark.pdf
```

The OpenAI evaluation uses `CHATGPT_API_KEY`, independent Responses API calls, and `store=false`.

## Interpretation

This is not a successful imperceptible natural-language prompt injection into Luna. The watermark alone produced R0 3/3. It is a successful local CV authentication and policy-routing prototype: the image signal selects trusted server policy, which then produces strict R2 responses while preserving tested benign queries.

## Limits

The result covers one synthetic four-page document, one commercial model, and a small transform suite. It does not establish human imperceptibility, print-scan robustness, crop/rotation robustness, or direct-web-upload effectiveness.
