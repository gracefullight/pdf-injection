import type { ProviderProfile, VisionProviderId } from "./types";

/**
 * Ingestion geometry for the three assistants a student is most likely to
 * upload an assignment PDF to.
 *
 * **Provenance.** Every rescaling number below is quoted from the vendor's own
 * current documentation (checked 2026-09-05), not inferred:
 *
 * - OpenAI, `detail: high`: "Scale down to fit in a 2048px x 2048px square,
 *   maintaining aspect ratio", then "If the shortest side exceeds 768px, scale
 *   it down to 768px", then 512px tiles.
 * - Anthropic: images are viewed as 28x28 patches, one visual token each. Each
 *   model has a long-edge limit *and* a visual-token budget, and an image is
 *   resized to the largest aspect-preserving size satisfying both. Standard
 *   tier: 1568px / 1568 tokens. High-resolution tier (Claude 4.7 and later):
 *   2576px / 4784 tokens.
 * - Google: document pages are "scaled down to a maximum resolution of
 *   3072 x 3072 while preserving their original aspect ratio, while smaller
 *   pages are scaled up to 768 x 768 pixels".
 *
 * **What is still an estimate.** Two things, and they matter:
 *
 * 1. **The legibility floors are engineering rules of thumb, not vendor
 *    figures.** Machine text recognition degrades below roughly 10px of cap
 *    height and is unreliable below about 6. No vendor publishes a legibility
 *    threshold, so a `reliable` verdict means "worth testing live", never
 *    "confirmed read".
 * 2. **Server-side page rasterization is out of our hands.** Anthropic's docs
 *    state it directly: for PDF uploads, "pages are rasterized to images
 *    server-side at dimensions you don't control". So the raster scale this
 *    tool renders at is an *upper bound* on the detail that reaches the model,
 *    never a guarantee of it — a vendor that rasterizes below our scale
 *    discards detail before the resize modelled here even begins.
 */
export const PROVIDER_PROFILES: Record<VisionProviderId, ProviderProfile> = {
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT (OpenAI)",
    maxLongEdgePx: 2048,
    shortEdgeTargetPx: 768,
    patchPx: null,
    maxVisualTokens: null,
    maxPixels: null,
    tilePx: 512,
    lossyRecompression: true,
    legibleCapHeightPx: 9,
    marginalCapHeightPx: 6,
    legibleContrastRatio: 1.35,
    marginalContrastRatio: 1.12,
    sourceNote:
      "Documented for detail:high — fitted within 2048x2048, then the shortest side scaled to 768px, then split into 512px tiles. The short-side pass is the most aggressive downscale of the three providers here, so it sets the floor for the whole plan.",
    uncertaintyNote:
      "OpenAI's vision documentation does not describe PDF handling, so the resolution its PDF path rasterizes pages at is unverified here. This profile assumes a page image then goes through the documented image path.",
  },
  claude: {
    id: "claude",
    label: "Claude (Anthropic)",
    // High-resolution tier (Claude 4.7 and later, which includes every model
    // this tool offers by default). Standard-tier models use 1568 / 1568.
    maxLongEdgePx: 2576,
    shortEdgeTargetPx: null,
    patchPx: 28,
    maxVisualTokens: 4784,
    maxPixels: null,
    tilePx: 28,
    lossyRecompression: true,
    legibleCapHeightPx: 10,
    marginalCapHeightPx: 7,
    legibleContrastRatio: 1.4,
    marginalContrastRatio: 1.15,
    sourceNote:
      "Images are viewed as 28x28-pixel patches, one visual token each, and resized to the largest aspect-preserving size that satisfies both a long-edge limit and a visual-token budget. These are the high-resolution-tier limits (2576px / 4784 tokens) that Claude 4.7 and later models use; older standard-tier models are held to 1568px / 1568 tokens and see roughly 1.7x less detail.",
    uncertaintyNote:
      "Anthropic documents that PDF pages are rasterized server-side at dimensions outside the caller's control, so the input to the resize modelled here is unknown for a PDF upload. A standard-tier model also halves the effective detail; this profile assumes the high-resolution tier.",
  },
  gemini: {
    id: "gemini",
    label: "Gemini (Google)",
    maxLongEdgePx: 3072,
    shortEdgeTargetPx: null,
    patchPx: null,
    maxVisualTokens: null,
    maxPixels: null,
    tilePx: 768,
    lossyRecompression: true,
    legibleCapHeightPx: 8,
    marginalCapHeightPx: 6,
    legibleContrastRatio: 1.3,
    marginalContrastRatio: 1.1,
    sourceNote:
      "Document pages are scaled down to at most 3072x3072 preserving aspect ratio, and pages smaller than 768x768 are scaled up to it. On paper this keeps the most page detail of the three.",
    uncertaintyNote:
      "Google also documents a flat cost of 258 tokens per document page and states there is no 'performance improvement for pages at higher resolution'. A fixed per-page budget that low is hard to reconcile with a 3072px page raster, so this profile's optimistic geometry may overstate the detail the model actually resolves. Treat a Gemini verdict here as the least certain of the three.",
  },
};

export const ALL_VISION_PROVIDERS: VisionProviderId[] = ["chatgpt", "claude", "gemini"];

export function getProviderProfile(id: VisionProviderId): ProviderProfile {
  return PROVIDER_PROFILES[id];
}

/**
 * Anthropic's standard resolution tier, for models older than Claude 4.7.
 *
 * Exported rather than folded into the profile because the difference is large
 * enough to change a verdict: the same page carries roughly 1.7x less detail
 * here, and which tier applies depends on the model the user actually calls.
 */
export const CLAUDE_STANDARD_TIER: ProviderProfile = {
  ...PROVIDER_PROFILES.claude,
  label: "Claude (Anthropic, standard tier)",
  maxLongEdgePx: 1568,
  maxVisualTokens: 1568,
  sourceNote:
    "Standard-tier limits (1568px long edge, 1568 visual tokens) for Claude models older than 4.7.",
};
