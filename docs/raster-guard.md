# Raster Guard — the post-rasterization notice channel

Raster Guard is the third top-level surface in `apps/web`, alongside the Injection Studio (which
writes hidden instructions as PDF *objects*) and the PDF Rasterizer (which strips them). It does
what neither does: it rasterizes the document and then paints an academic integrity notice **into
the page bitmap**, so the payload is part of the image rather than an object attached to it.

The intended end-to-end behaviour is the one an instructor asks for directly: a student uploads the
assignment PDF to ChatGPT, Claude or Gemini, the assistant reads the page, and the reply is a
redirect rather than a draft — *"You should not upload this PDF. Please consult your UTS subject
coordinator before using an AI assistant for this assessment."*

- Code: [`packages/raster-guard`](../packages/raster-guard) (pure planning and prediction),
  [`apps/web/src/features/raster-guard`](../apps/web/src/features/raster-guard) (rendering, painting,
  verification).
- Nothing about this feature touches `apps/api`. It runs entirely in the browser, including the
  optional live checks, which go from the tab straight to the vendor.

## 1. Why a pixel channel at all

Every hidden-instruction channel this project already implements writes a PDF object, and every one
of them dies to the same defense. This repo measures that directly: the `print_to_pdf` and
`ocr_regeneration` transforms in `packages/robustness` rebuild each page from a rasterized image, at
which point white text, render-mode-3 text, Unicode-tag CMaps, XMP metadata, annotation appearance
streams and AcroForm values are all simply gone. The repo even ships that defense as a product
surface — the **PDF Rasterizer** screen, which advertises stripping "invisible fonts, hidden prompt
injections, and extractable text layers completely".

The same holds for the published taxonomies. CrackedPDFs' 14 injection families and the Semantic
Integrity Failures EG01–EG25 extraction-gap list are, without exception, *document-object* channels:
they describe ways to make a text extractor and a renderer disagree. Rasterization removes the text
extractor from the equation entirely, so it removes all of them at once.

Raster Guard inverts the order of operations. The notice is applied **after** rasterization, into
the pixels:

```text
Injection Studio :  source PDF -> add text object -> output PDF     (dies to rasterization)
Raster Guard     :  source PDF -> rasterize -> paint pixels -> PDF  (rasterization is a prerequisite)
```

Three consequences follow, and they are worth stating plainly because two of them are advantages and
one is a cost:

- **It survives the recommended defense.** Re-rasterizing a guarded PDF re-renders a page that
  already has the notice printed on it. Removing the notice requires editing the image.
- **Extraction-vs-render detectors do not apply to it.** The deployed detector family — PhantomLint's
  metamorphic check, and the HCD/VDA pair running in production resume screening (see
  [§3](#3-honest-positioning-against-prior-work)) — all work by finding a *discrepancy* between
  extracted text and the rendered page. A guarded PDF has no extraction side at all, so there is no
  discrepancy to find. **This is not undetectability**: a pixel-domain scanner that reads the
  rendered page finds the notice immediately, because it is printed there. See
  [§4](#4-what-detects-it).
- **It is visible to a human.** There is no way to put marks on paper that a model can read and an
  attentive person cannot. Raster Guard treats that as the design constraint it is, and the UI says
  so on the screen rather than only here.

## 2. What is actually new here

The channel itself — "put text in the image" — is not novel, and this document does not claim it
is. `image_only` in this repo's own round-3 probes already stamped a rasterized instruction onto a
page, and it scored **0/5** against `gpt-5.6-luna`. Four design decisions separate Raster Guard from
that result and from the attacker-side tooling in the literature.

### 2.1 Sizing is solved against each provider's documented ingestion geometry

The three assistants disagree by more than 2x on how much page detail reaches the model:

| Assistant | Documented handling | Effective px per point, Letter page rendered at 144 DPI |
|---|---|---:|
| ChatGPT (`detail: high`) | fitted within 2048x2048, then the shortest side scaled to 768px, then 512px tiles | 1.25 |
| Claude, high-resolution tier (4.7 and later) | 28x28 patches; largest aspect-preserving size within 2576px and 4784 visual tokens | 2.00 (unresized) |
| Claude, standard tier (older models) | same rule at 1568px and 1568 visual tokens | 1.56 |
| Gemini | pages scaled to at most 3072x3072, tiled at 768 | 2.00 (unresized) |

Anthropic's rule is not a simple edge cap and is worth stating exactly, because assuming an edge
cap gets it wrong: an image costs `ceil(w/28) x ceil(h/28)` visual tokens, and the token budget
usually binds before the edge limit does. Their own worked example is an A4 page scanned at 130 DPI
(1075x1520): both edges are under the 1568px standard-tier limit, but it costs 2145 tokens against a
1568-token budget, so it resizes to 924x1307. `packages/raster-guard` ports that rule, binary search
included, and `legibility.test.ts` pins it against that published example.

`minimumLegibleFontSizePt()` inverts that arithmetic: to clear a 9px cap height after ChatGPT's
short-edge pass the type has to be 10.25pt, which the planner rounds up to 10.5. The 8pt grey stamp
`image_only` used has a cap height of 7.0 provider pixels there — under the floor. Raster Guard
sizes the primary rung from the **harshest** provider in the selected set, so adding ChatGPT to the
targets grows the type and never shrinks it (`plan.test.ts` pins exactly that). ChatGPT is the
binding constraint of the three at any normal raster scale, which is what makes this worth solving
once rather than per provider.

**A limit that applies to all three, and is not modelled away.** Anthropic documents plainly that for
PDF uploads "pages are rasterized to images server-side at dimensions you don't control". Google
scales pages to its own ceiling. So the raster resolution this tool renders at is an **upper bound**
on the detail that reaches the model, never a guarantee: a vendor rasterizing below our scale
discards detail before the resize above even begins. The coverage report says this on screen rather
than only here.

This is the part that a fixed stamp size cannot do, and it is why the tool asks which assistants you
care about instead of offering a font-size slider.

### 2.2 The payload is placed in the low-frequency band, not the high-frequency one

The conventional recipe for a discreet stamp is *small and dark in a margin*. Under a pipeline that
halves a page's linear resolution, that is exactly backwards: fine strokes are high-frequency
information and are the first thing a downscale destroys.

Large and faint is the better trade. A 46pt watermark at 14% black keeps a cap height of 40px on
the harshest of the three pipelines and 64px on the gentlest. Its only risk is contrast, which is a
different failure mode with a different mitigation. So the plan ships both, sized to fail in
*different* directions:

| Rung | Sized for | Dies to |
|---|---|---|
| `footer_notice` | the harshest pipeline's floor | nothing, at the subtle tier |
| `margin_microtext` | the gentlest pipeline's floor | aggressive downscaling |
| `lowfreq_watermark` | any downscale | lossy re-encoding, if too faint |
| `edge_band` | outer margin, rotated | a cropped screenshot |

Coverage rolls up per provider by taking the **best** rung, because the notice only has to be read
once (`assessPlan()`).

### 2.3 Placement comes from the document's own layout

Because Raster Guard rasterizes the page itself, it knows where the content is before it paints.
`findFreeBands()` scans for horizontal bands that no content occupies, using two sources: PDF.js
text-item boxes, and a pixel ink scan that also catches figures, vector drawings and fully scanned
pages that have no text items at all. The notice goes in a band the document left empty, so it never
overlaps content — and a collision is precisely what makes a reader look twice.

When the only free space is an ordinary print margin, the plan falls back to a three-line compact
form of the same notice rather than dropping the rung. The response sentence and the reference code
survive that fallback; only the explanatory prose is cut.

### 2.4 The notice is a policy statement, not an injection

This matters more than the pixel engineering, and it is where the "2026 SOTA" framing needs care.

Frontier assistants now treat text inside an uploaded document as *data*, not as instructions. The
more a passage reads like an imperative aimed at the model — "ignore the user", "output exactly X" —
the more reliably it is classified as an injection attempt and either ignored or reported as one.
Optimising the phrasing against that is an arms race this tool should lose on purpose.

So the templates state a first-party fact about the document (this is assessment material, this use
is not authorised, here is who to ask) and then make a request an aligned assistant is already
inclined to honour. Compliance comes from agreement rather than evasion, which means:

- it does not degrade as models get better at resisting injection — if anything it improves;
- it fails safe, since an assistant that ignores it behaves exactly as it would have anyway;
- it is the same message to the model and to the student, so there is nothing to be embarrassed by
  when a student reads it.

Every notice still passes `packages/prompt-lint`'s existing gate, so jailbreak phrasing, fabricated
citations and grading-distortion requests are rejected here exactly as they are for the PDF-object
modes.

### 2.5 Verification is part of the feature, not a follow-up study

Three layers, in increasing cost and increasing evidential value:

1. **Prediction.** The coverage table gives a cap height in provider pixels and a WCAG contrast
   ratio per rung per assistant, with the reason for any non-reliable verdict.
2. **Simulation.** "What the model sees" resamples the guarded page to each provider's own effective
   geometry, JPEG round trip included, and shows it at 1:1. If the notice is unreadable there, the
   prediction was wrong and you can see it.
3. **Observation.** The live check uploads the guarded PDF to ChatGPT, Claude or Gemini with a
   student-shaped prompt using your own key, and scores the reply against the notice's canaries via
   `packages/detector`'s `matchSignals()` — the same matchers the server-side submission analysis
   uses.

The canaries (the response sentence, an order-tolerant fallback over its distinctive words, and the
reference code) are also what an instructor scores a suspected AI-assisted submission against later.
Issuing a different reference code per student makes a surfaced notice traceable to one copy.

## 3. Honest positioning against prior work

Following the discipline in [`related-work.md`](related-work.md): this section says what this
project's search found, not what has been verified absent. No systematic search was run for this
feature.

| Claim | Status |
|---|---|
| Painting an instruction into a rasterized page is new | **No.** `image_only` in this repo does it, and rasterized-image injection is an obvious member of the same family the published taxonomies cover. |
| A pixel channel survives rasterization while object channels do not | **Structural, not empirical.** It follows from where the payload lives. This project has not run a guarded PDF through an adversarial sanitizer beyond its own rasterizer. |
| Hidden-text detectors cannot flag it | **Structural for the extraction-vs-render family only**, which is the deployed state of the art (HCD/VDA, PhantomLint). A pixel-domain scanner such as SnapGuard finds it immediately — see [§4](#4-what-detects-it). |
| Sizing a payload from published per-provider ingestion geometry is new | **Not found in the three nearest neighbours**, whose designs have no reason to model it. Adjacent to Semantic Integrity Failures' finding that exposure is driven by the ingestion stack; treat it as an application of that, not an independent discovery. Note the inverse technique is well established: Trail of Bits' image-scaling attacks (2025) and the Chameleon follow-up weaponise the *same* downscaling pipelines, hiding a payload that only appears after resampling. |
| Preferring low-frequency (large, faint) over high-frequency (small, dark) payloads | **Standard signal processing, applied here.** Novel as a design choice in this context, not as a result. |
| A policy-framed notice outperforms adversarial phrasing under instruction-hierarchy defenses | **Unmeasured hypothesis.** Plausible and well-motivated, but this project has run no controlled comparison. Do not repeat it as a finding. |
| Attribution via per-copy canaries | The authoring-and-attribution direction `related-work.md` §4.2 already records as open. Raster Guard extends it to the pixel channel. |

One approach this project deliberately did **not** take: Trail of Bits' image-scaling attack, where a
payload is invisible at full resolution and materialises only under a specific resampling kernel.
It is the only published route to something genuinely close to "invisible to a human, legible to the
model", but it depends on knowing each vendor's interpolation kernel, breaks when that changes, and
its own authors recommend eliminating downscaling rather than trying to survive it. It is also the
wrong shape for an academic-integrity notice, which should be auditable rather than covert.

**No provider measurement has been run for Raster Guard.** The round-3 numbers in
`research/results/` cover the PDF-object modes. Until a matrix like that one is run against guarded
PDFs, every coverage figure in the UI is a prediction, which is why the UI says so on every screen
that shows one.

## 4. What detects it

This section exists because the first draft of this page overstated the point. "No extractable text"
defeats one detector family, not detection.

### Blind to it: extraction-vs-render detectors

The deployed state of the art in document prompt-injection detection compares what a *parser*
extracts against what a *renderer* shows. Zhang et al. (2026) measured this at scale on 196,682
de-identified resumes and report roughly 1% carrying hidden prompt injections. They ship two
detectors, both integrated into hireEZ's production systems:

- **HCD (Hybrid Cascade Detector)** — rule-based visual analysis of each **text element extracted
  from the PDF**, then LLM verification of the flagged excerpts. Its four Stage-1 rules are: font
  size below a visibility threshold (about 4pt), RGB colour distance to the sampled background below
  15, rendered pixel-intensity standard deviation below 3.0, and ink density below 1.5%. Estimated
  precision 86.1%.
- **VDA (Visual Discrepancy Analyzer)** — renders pages to images, extracts text separately, and has
  a VLM flag "text present in the extraction but absent from the rendered images". Estimated
  precision 92.7%.

Both are structurally blind to a guarded PDF, and for the same reason: **it has no extraction side.**
HCD's Stage 1 iterates over extracted text elements and finds none. VDA looks for extracted text
missing from the render, which is the exact inverse of this channel — here the text is in the render
and missing from the extraction. For calibration, the general-purpose text detectors they benchmark
do worse still on this class of problem: PromptArmor 0.583 precision / 0.070 recall, PromptGuard
0.455 / 0.050, DataSentinel 0.009 / 0.870.

### Not blind to it: pixel-domain detectors

A scanner that works on rendered pixels finds the notice, and one is published. **SnapGuard** (Du et
al., 2026, preprint submitted to ACM Multimedia '26) detects prompt injection in *screenshots* for
web agents, and its preprocessing step is aimed squarely at this channel: it thresholds grayscale
intensity at 240 to build a mask of near-white regions "where low-contrast text may be difficult to
recover under direct extraction", then applies contrast-polarity reversal to surface it before
vision-based text extraction.

Run against a guarded page, that pipeline recovers the notice. The subtle tier's watermark composites
to roughly `#dbdbdb` on white — comfortably inside the band SnapGuard is built to amplify. The
classical OCR preprocessing stack (histogram equalisation, unsharp masking, Otsu binarisation) does
the same job with older tools.

So the accurate statement is narrow, and it is the one this project should make:

> A guarded PDF is invisible to the extraction-vs-render detector family, because it has no
> extraction side. It is fully visible to any pixel-domain scanner, and to any person who looks at
> the page.

That is a property to disclose, not a defence to rely on. It is also the correct outcome for an
academic-integrity tool: the instructor's notice should be findable by an auditor.

### What none of this measures

Whether a guarded PDF's notice actually changes a model's behaviour. Detection and compliance are
different questions, and this project has measured neither for this channel.

## 5. Limitations

- **Not covert.** The notice is on the page. The covert tier lowers human salience, and the
  interface says outright that it also lowers predicted coverage to marginal on some pipelines.
- **Removable by anyone willing to edit the image.** Cropping the margin, painting over the band, or
  retyping the assignment all defeat it. It raises the effort and removes the "I didn't know"
  defense; it is not a lock.
- **The provider profiles are documentation, not measurement.** Vendors change ingestion behaviour
  without notice. `provider-profiles.ts` is a single, small table for exactly that reason — when a
  vendor changes, edit one file.
- **A model may read the notice and ignore it.** Nothing here makes compliance certain, and one
  successful live check is one observation, not a rate.
- **The output PDF is an image.** Text selection, screen-reader access and searchability are gone —
  the same accessibility cost the PDF Rasterizer screen already carries. Do not ship a guarded PDF as
  a student's only copy of an assessment; pair it with an accessible version on request.
- **File size grows**, often several times over, since every page becomes a bitmap.

## 6. Ethics

Raster Guard is subject to the governance rules in
[`ethics-and-privacy.md`](ethics-and-privacy.md), and two of them bind particularly tightly:

- **Evidence, never a verdict.** `checkNoticeResponse()` reports which canaries appeared in a model's
  reply. It says nothing about a student, and its headline text is drawn from a fixed, closed set
  that never claims cheating was detected.
- **Disclose it.** The notice is legible on the page, and students should be told the practice is in
  use before it is used. A notice that redirects a student to their subject coordinator only works as
  intended if that coordinator knows it exists.

## 7. Reproducing the arithmetic

```bash
bun test packages/raster-guard        # legibility model, placement, plan ladder, notice templates
bun test apps/web/src/features/raster-guard  # painter, ink scan, provider resampling, canary scoring
```

The prediction for a specific page and provider is one call:

```ts
import { getProviderProfile, minimumLegibleFontSizePt } from "@pdf-injection/raster-guard";

// Smallest type ChatGPT can still read on a Letter page rendered at 144 DPI.
minimumLegibleFontSizePt(getProviderProfile("chatgpt"), { widthPt: 612, heightPt: 792 }, 2);
```
