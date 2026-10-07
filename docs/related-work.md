# Related Work

This page positions PDF Injection against the nearest published and preprint work on hidden
instructions in PDFs, states what each claim's peer-review status actually is, and marks what
this project's own search found to be open. It exists because novelty claims are easy to overstate
and hard to walk back once repeated — every claim below is tagged so a reader (or a future
contributor) can tell a refereed finding from an unrefereed one at a glance.

## Core references for image-based response steering

Added and checked on 2026-09-27. The current surrogate-model research studies whether
modifying a document image can steer a VLM's generated response. The user identified
ImageProtector as the main reference. STAB is the main paper presented in
`Transferable Backdoor Attacks-Code Models.pptx` (slides 1–13); slides 14–16 propose
an adaptation to PDF malware detection. Those final slides are an experiment proposal,
not PDF results reported by the STAB paper.

### ImageProtector — primary research reference

Shao, Z., Liu, H., Hu, Y., & Gong, N. Z. (2026). **Leave My Images Alone: Preventing
Multi-Modal Large Language Models from Analyzing Images via Visual Prompt Injection.**
In *Proceedings of the 64th Annual Meeting of the Association for Computational
Linguistics (Volume 1: Long Papers)*, pp. 1588–1604.
[ACL Anthology](https://aclanthology.org/2026.acl-long.72/) ·
[PDF](https://aclanthology.org/2026.acl-long.72.pdf) ·
[DOI: 10.18653/v1/2026.acl-long.72](https://doi.org/10.18653/v1/2026.acl-long.72).

- **Status:** published ACL 2026 long paper; title, authors, venue, pages and DOI
  checked against ACL Anthology.
- **Method:** optimizes bounded image perturbations to induce refusal responses,
  using gradients and a set of anticipated questions. Its stated focus is open-weight
  MLLMs.
- **Relation to this repo:** the direct basis for optimizing document pixels against
  a frozen local VLM. PDF rendering, content preservation, selective responses and
  transfer to other models are additional questions in this repository. The paper's
  results do not establish that this repo's PDFs transfer to commercial models.

### STAB — main reference from the presentation

Chang, S., Huang, H., Zhang, Y., Huang, Y., Xiao, F., & Zhang, L. Y. (2026).
**Transferable Backdoor Attacks for Code Models via Sharpness-Aware Adversarial
Perturbation.** *Proceedings of the AAAI Conference on Artificial Intelligence,
40*(1), 57–65.
[AAAI proceedings](https://ojs.aaai.org/index.php/AAAI/article/view/36964) ·
[DOI: 10.1609/aaai.v40i1.36964](https://doi.org/10.1609/aaai.v40i1.36964) ·
[arXiv:2602.11213](https://arxiv.org/abs/2602.11213).

- **Status:** published AAAI 2026 paper; bibliographic details checked against the
  publisher and the authors' arXiv record.
- **Method:** trains a surrogate with SAM, then uses Gumbel-Softmax to optimize
  identifier-based triggers for code-model backdoors. It evaluates transfer across
  surrogate/victim datasets and resistance to defenses.
- **Relation to this repo:** a methodological reference for surrogate-based
  transfer. STAB poisons training data; this repo's image experiments modify inputs
  at inference time. Its code-model results are not evidence of PDF/VLM transfer.
- **Presentation extension:** the PDF proposal replaces a non-differentiable
  detector with an MLP and searches over structural/metadata edits. This differs
  from the repo's frozen Qwen model and pixel optimization.

### Supporting references for methods and baseline named in the presentation

The slides name these methods but do not provide a complete bibliography. The
following records identify their source papers; this is a selected reading list.

| Method | Reference and checked source | Why it is relevant |
|---|---|---|
| SAM | Foret, P., Kleiner, A., Mobahi, H., & Neyshabur, B. **Sharpness-Aware Minimization for Efficiently Improving Generalization.** [arXiv:2010.01412](https://arxiv.org/abs/2010.01412), first posted 2020, revised 2021. | Explains the surrogate-training procedure used by STAB. |
| Gumbel-Softmax | Jang, E., Gu, S., & Poole, B. **Categorical Reparameterization with Gumbel-Softmax.** [arXiv:1611.01144](https://arxiv.org/abs/1611.01144), first posted 2016, revised 2017. | Makes discrete choices amenable to gradient optimization; used for STAB trigger tokens and proposed PDF edit choices. |
| AFRAIDOOR | Yang, Z., Xu, B., Zhang, J. M., Kang, H. J., Shi, J., He, J., & Lo, D. (2023). **Stealthy Backdoor Attack for Code Models.** [arXiv:2301.02496](https://arxiv.org/abs/2301.02496). | Adaptive code-trigger baseline compared with STAB. This entry identifies the arXiv version; journal publication status was not checked. |

### What SAM means here

SAM stands for **Sharpness-Aware Minimization**. During model training, it seeks
weights whose nearby values also have low loss. It approximately finds a small
weight perturbation that increases loss, then updates the original weights using
the gradient evaluated at that perturbed point. This favors a broad low-loss region
over a narrow minimum. See the [SAM paper](https://arxiv.org/abs/2010.01412).

STAB uses this training procedure to improve transfer in its code-backdoor setting.
That is a motivation to investigate, not a guarantee of transfer to another VLM.
The current [`document_refusal_search.py`](../research/document_refusal_search.py)
loads and freezes the VLM, then optimizes image pixels. It implements neither SAM
training nor Gumbel-Softmax. Applying SAM would require a separate model-training
experiment.

Repository context:
[`ImageProtector document extension`](../research/imageprotector-document-extension.md) ·
[`surrogate pilot results`](../research/results/2026-09-13-surrogate-factorial/README.md).

## Additional close references as of 2026-09-27

A targeted search found relevant work beyond ImageProtector and STAB. This is not
a systematic review or evidence that all related papers have been found. The
comparison below separates image-level response control, model transfer, and
refusal through a safety filter. Closeness to this repository is our assessment.

| Work | Date / checked status | Connection and distinction |
|---|---|---|
| Bailey, Ong, Russell & Emmons, **Image Hijacks: Adversarial Images can Control Generative Models at Runtime** | ICML 2024, PMLR 235:2443–2455; [publisher record](https://proceedings.mlr.press/v235/bailey24a.html). Earlier preprint: 2023. | Direct precedent for controlling generated responses through optimized images at inference time. Introduces behaviour matching and prompt matching. Its objective is broader than protective refusal, and results depend on the attack and image constraint. |
| Ding, Xia, Kong & Jiang, **Covert Visual Prompt Injection against Commercial Multimodal Large Language Models** (CoTTA) | [arXiv:2603.29418v2](https://arxiv.org/abs/2603.29418v2), 2026-08-11; first posted 2026-03-31 under the title *Adversarial Prompt Injection Attack on Multimodal Large Language Models*. Preprint; venue not verified. | Particularly close to the transfer problem: combines a bounded text overlay with image perturbations and visual/textual feature alignment to steer commercial MLLM outputs. The overlay means it is not a text-free perturbation baseline. |
| Chen, Tsai, Evtimov, Chaudhuri, Popa, Wagner & Zharmagambetov, **Repeat-After-Me: Black-Box Adaptive Visual Prompt Injection** | [arXiv:2609.04533v2](https://arxiv.org/abs/2609.04533v2), 2026-09-15; first posted 2026-09-03. Preprint; also listed by [Meta Research](https://ai.meta.com/research/publications/repeat-after-me-black-box-adaptive-visual-prompt-injection/). | Black-box response steering using rendered response prefixes and adaptive search. Relevant to visual text controls and transfer evaluation; not an imperceptible, text-free pixel method. Its negative gradient-transfer baselines are relevant to our current bottleneck. |
| Shi et al., **The Boy Who Cried Wolf: Adversarial Misclassification of Safe Inputs as Unsafe in Multimodal Guardrails** | [arXiv:2608.01373](https://arxiv.org/abs/2608.01373), 2026-08-02. The author record states acceptance at KDD 2026; proceedings metadata not independently checked. | Perturbs safe images to induce rejection by multimodal guard models. Close to refusal induction, but targets a safety classifier rather than the document-reading generator's response. |
| Nasery, Kumar, Hsieh & Oh, **MIRAGE: Protecting against Malicious Image Editing via False Moderation** | [arXiv:2606.26199](https://arxiv.org/abs/2606.26199), first posted 2026-06-24. Preprint; venue not verified. | Protects images by causing commercial editing systems' moderation to reject them, using open-source embedding/moderation ensembles. Relevant to protective refusal and transfer, but studies image editing and moderation rather than document question answering. |

ImageProtector remains the closest starting point for the protective-refusal
objective. CoTTA and Image Hijacks are more directly related than STAB to steering
a VLM through image inputs. STAB remains a reference for a possible surrogate
training method, not the main prior work for visual response control.

In Section 4.2, [Repeat-After-Me](https://arxiv.org/html/2609.04533v2) reports zero
attack success for its TransferEns baseline using Qwen3-VL-4B-Instruct,
Qwen2.5-VL-3B-Instruct and InternVL3.5-4B. Those tests target exact information
disclosure and tool-call outputs; they do not establish that semantic refusal
transfer is impossible. They do show why adding more surrogates alone cannot be
assumed to solve our transfer problem. Its rendered-text method must be evaluated
separately from text-free perturbations.

The search covered visual prompt injection, image protection through refusal,
commercial-model transfer, and document/PDF protection. Metadata and abstracts were
checked at author/publisher sources; CoTTA and Repeat-After-Me method sections were
also inspected. No full reproduction or systematic novelty audit was performed.
PDF rendering robustness, content preservation and selective policy responses are
questions to test, not established novelty claims.

## 1. How to read this page

Two independent axes matter for every citation here:

- **Peer-review status.** A preprint (arXiv, no venue) has not been through review; its claims,
  including its own novelty claims, may not survive review unchanged. A refereed venue (a journal
  with a DOI, or a conference with an accepted-paper listing) has been through some review process,
  though acceptance criteria vary widely by venue.
- **What was actually measured**, independent of how a paper's abstract frames it — several
  detection papers below are cited elsewhere as "hidden-prompt-injection" work when what they
  measure is text-extraction/OCR divergence, not whether an LLM was influenced.

**Provenance was checked directly against arXiv metadata on 2026-08-22** by fetching each paper's
arXiv abstract page. Nothing below is taken on faith from a citation list; where a status could not
be verified independently (the two AIES/ICLR 2026 citations below), that is stated explicitly
rather than assumed.

## 2. Comparison table

| Work | Venue / status | What it measures | LLM inference in scope? | Unicode Tag characters discussed? |
|---|---|---|---|---|
| Rao, Kumar, Lakkaraju, Shah — "Detecting LLM-Generated Peer Reviews" ([arXiv:2503.15772](https://arxiv.org/abs/2503.15772)) | **Peer-reviewed** — PLOS ONE 20(9): e0331871 (2025), [DOI 10.1371/journal.pone.0331871](https://doi.org/10.1371/journal.pone.0331871). *The arXiv abstract page itself lists no journal reference* — see [discrepancy note](#discrepancy-note) below. | Detecting AI-generated text in peer reviews | Yes (reviews as LLM output) | No |
| Toby Murray — "PhantomLint: Principled Detection of Hidden LLM Prompts in Structured Documents" ([arXiv:2508.17884](https://arxiv.org/abs/2508.17884), Aug 2025, rev. Oct 2025) | **Preprint. No venue listed.** | Metamorphic detection (extracted text vs. OCR of the rendered page) | No — detection only, no model calls | No |
| Thienpreecha & Subramanian — "CrackedPDFs: A Controlled Benchmark for Hidden Prompt Injection in PDFs" ([arXiv:2607.19396](https://arxiv.org/abs/2607.19396), Jul 2026, rev. Aug 2026) | **Preprint. No venue listed.** | PDF classification benchmark across 14 injection families | No — detection only, no model calls | No |
| Liu & Ming — "Semantic Integrity Failures in Document-to-LLM Supply Chains" ([arXiv:2606.15020](https://arxiv.org/abs/2606.15020), Jun 2026) | **Preprint. No venue listed.** | Extraction divergence *and* output faithfulness, across ingestion stacks and commercial LLM services | Yes — 7 commercial services | No |
| Xiong et al. — "Invisible Prompts, Visible Threats: Malicious Font Injection…" ([arXiv:2505.16957](https://arxiv.org/abs/2505.16957), May 2025) | **Preprint. No venue listed.** | Font-glyph-remapping injection | Not verified by this project — not read in full; listed here for completeness | Not verified by this project |
| wppoland/[hidden-text-detector](https://github.com/wppoland/hidden-text-detector) (GitHub) | **Open-source tool, not a paper.** | Hidden-text detection heuristics | No | No |
| Kirchenbauer et al.; Dathathri et al.; Zhang et al.; Tu et al. (cited in this project's PRD §30) | **Peer-reviewed** — ICML 2023, *Nature* 2024, ICML 2024, ACL 2024 respectively | Token-probability / generation-time watermarking (not document-borne) | Yes | N/A |
| Aiersilan et al.; Liu et al. (cited in this project's PRD §30) | Cited by the PRD as **AIES 2026 (accepted)** and **ICLR 2026** respectively | Not reviewed by this project | Unverified | Unverified |

Acceptance for the two PRD §30 entries in the last row is **as claimed by the PRD, not
independently confirmed by this page** — flagged the same way the arXiv/journal discrepancy is
flagged below, rather than silently treated as settled.

### Discrepancy note

This project's own PRD cites Rao, Kumar, Lakkaraju & Shah under the same authors and title as the
arXiv preprint above, but as **PLOS ONE 20(9): e0331871 (2025)**,
[DOI 10.1371/journal.pone.0331871](https://doi.org/10.1371/journal.pone.0331871). The arXiv
abstract page for 2503.15772 does not itself display a journal reference. Both are treated here as
the same underlying work, now peer-reviewed via the journal publication — but the discrepancy
between "what the arXiv page shows" and "what the PRD cites" is recorded here rather than silently
resolved, since it is exactly the kind of gap this page exists to surface.

## 3. What is already covered by prior work

Two things this project might otherwise be tempted to claim as novel are, on inspection, already
covered:

- **The channel inventory.** Every injection channel this project implements
  (`white_text`, `render_mode_3`, `xmp_only`, `unicode_tags`, `visible_positive_control`), and
  every channel that was considered while designing it, appears in either CrackedPDFs' 14 injection
  families (render mode 3, tiny font, white text, low-contrast, off-page, near-margin, in-page,
  stream modification, semantic fragmentation, margin microtext, steganographic acrostics,
  microglyph steganography, split text objects, layout mimicry) or the Semantic Integrity Failures
  EG01–EG25 extraction-gap taxonomy (`/ToUnicode` remapping, `/ActualText` substitution, `3 Tr`,
  colour/transparency, off-page, near-zero font size, clipping-path masking, matrix-scale
  degeneration, optional-content invisibility, `7 Tr` clipping mask, zero-height text matrix,
  page-geometry occlusion, OCG suppression, reading-order splits, font-decoding splits). This
  project did not discover a new channel.
- **Channel-by-channel measurement against commercial LLM services with matched controls.**
  Semantic Integrity Failures already did this, more broadly than this project has: 1,260
  matched-control runs (36 gap–modality pairs × 7 commercial platforms × 5 trials — Sonnet 4.6,
  Grok 4.2, GPT-5.4, Gemini 3, Kimi K2.6, Qwen-Long, GLM-5.1) against zero attacker-side claims,
  and 16 PDF processing stacks besides. This project's own measurement (below) is a single
  provider, six conditions, five repeats — a much smaller instance of the same kind of study, not
  an independent methodology.

## 4. What remains open, as far as this project's search found

This project's literature search was **shallow** — two web searches plus reading three preprints
in full. With that caveat stated up front, three things appear to remain open:

1. **The Unicode Tags block as a PDF-borne channel.** It is absent from all three nearest-neighbour
   works (CrackedPDFs' 14 families, PhantomLint's checks, and the EG01–EG25 list). This project's
   own finding is negative, not positive: the channel **does not survive** this project's own
   validation layer, because PDF text extraction filters Unicode General Category "Cf" (Format)
   characters — verified directly in `pdfjs-dist` and, separately, observed as a 0/5 behavioral
   effect against one commercial provider (see [§5](#5-detectability-finding-and-what-it-implies)
   and the measurement table below). Whether other extraction pipelines behave the same way is
   untested by this project.
2. **The authoring-and-attribution direction.** Instructor-designed canaries, a prompt linter
   flagging unfair/fabricated-content requests, a hash-linked private manifest recorded *before*
   distribution, and false-positive-controlled submission analysis (Fisher's exact test +
   Holm-Bonferroni correction) — see [`docs/ethics-and-privacy.md`](ethics-and-privacy.md) and
   [`docs/research-protocol.md`](research-protocol.md). The three nearest neighbours are all
   attacker-side (how to inject) or defender-side (how to detect an injection already present);
   none of them address attribution — designing a distributable artifact whose match evidence is
   traceable back to a specific pre-registered instruction and (optionally) a specific
   student-issued copy.
3. **A visible positive control as a first-class experimental condition.** Treating
   `visible_positive_control` as one of the benchmark's conditions (rather than an afterthought)
   separates "the channel failed to reach the model" from "the model saw the instruction and did
   not follow it" — a distinction none of the three nearest neighbours' designs need, since none of
   them are testing whether a model *complies* with an embedded instruction at all.

An **"extractor fingerprinting" probe** — inferring which ingestion path a provider uses from which
per-channel canary surfaces in its output — is **adjacent, not independent**: it is a direct
application of Semantic Integrity Failures' own conclusion that "exposure is driven mainly by the
ingestion stack, not model identity alone." It should be positioned as an extension of that finding,
never as an independent discovery.

## 5. Detectability finding and what it implies

PhantomLint reports **100% detection (113/113) on positive documents and a 0.092% false-positive
rate (3/3,257 ICML 2025 papers)** for exactly the kind of hidden-text channels this project's two
working modes use: white text and PDF text-rendering mode 3. That means **an instructor's canary,
authored with this project's `white_text` or `render_mode_3` modes, is discoverable by anyone who
runs a metamorphic extracted-text-vs-OCR check** — a student, an institution's screening pipeline,
or a journal's own submission checker.

This project treats that as a property of the design, not a flaw to route around:

- The manifest recording the exact instruction and file hashes is written **before** distribution
  (see [`docs/ethics-and-privacy.md`](ethics-and-privacy.md#governance-requirements), governance
  requirement 8), so there is no way to retroactively claim a different canary was used.
- The injection mode is disclosed in this project's own documentation, not hidden from the person
  running it.
- Detectability is what keeps the practice auditable — a professor, an institution, or a
  researcher can independently verify what was embedded and confirm it matches the recorded
  manifest, rather than trusting an opaque, undetectable mechanism. Undetectability would remove
  exactly the auditability this project's ethics rules depend on (see
  [`docs/ethics-and-privacy.md`](ethics-and-privacy.md), governance requirement 9: any presentation
  of results must show uncertainty and alternative explanations, never a bare
  "detected/not detected" claim).

This project's own measurement (below) shows the same story from the other side: the channels that
carry a signal reliably (`white_text`, `render_mode_3`) are exactly the channels PhantomLint
detects reliably. There is no mode in this project's inventory that is both effective and hidden
from a detector — see [`docs/limitations.md`](limitations.md) and the positioning note in
[`README.md`](../README.md#what-this-is-not).

### This project's own measurement

Run against the real provider `gpt-5.6-luna` via OpenAI, one 4-page synthetic software-engineering
assignment PDF ([`research/datasets/se-assignment-architecture-quality-plan.pdf`](../research/datasets/se-assignment-architecture-quality-plan.pdf)),
three canaries (methodology label "hexagonal architecture" plus exact phrases "design entropy" and
"Trade-off Ledger"), 6 conditions × 5 repeats = 30 calls, 0 errors, variation across repeats 0
(raw data: `research/results/2026-08-22-openai-gpt-5.6-luna/se-assignment-6conditions-repeats5.model-tests.csv`):

| Condition | All-signal rate | Δ vs. original |
|---|---|---|
| `original` | 0/5 | — |
| `white_text` | 5/5 | +100 pp |
| `render_mode_3` | 5/5 | +100 pp |
| `unicode_tags` | 0/5 | 0 pp |
| `xmp_only` | 0/5 | 0 pp |
| `visible_positive_control` | 5/5 | +100 pp |

**One provider, one document, one run — this is not a claim that `unicode_tags` fails everywhere**,
only that it did not survive this project's own PDF.js-based extraction path in this one
measurement, consistent with the Cf-category filtering explanation in
[`docs/limitations.md`](limitations.md#unicode_tags-caveats).

The methodology signal alone matched 5/5 **even in the untouched `original` condition** — the
assignment's own text makes "hexagonal architecture" the natural methodology choice regardless of
any injected instruction. This is why lexical/structural canaries ("design entropy", "Trade-off
Ledger" — terms with no reason to appear unless the instruction was followed) carry the actual
evidence, not the methodology label alone. This project treats that as its own demonstration of the
false-positive risk governance requirement 4 and 9 in
[`docs/ethics-and-privacy.md`](ethics-and-privacy.md) already warn about.

### Round-3 probe modes: detectability expectation, not a measured result

Round 3 added four research/diagnostic probe conditions (`image_only`, `freetext_annot`,
`acroform_field`, `info_dict` — see [`README.md`](../README.md#injection-modes) and
[`docs/limitations.md`](limitations.md#image_only--freetext_annot--acroform_field--info_dict-caveats-round-3-probes)).
None of them have been run against PhantomLint or any other detector by this project — the
following is stated as an expectation grounded in how the channels are constructed, not as a
measured finding, and should be read with that caveat every time it is cited.

- **`freetext_annot` and `acroform_field`** draw real, invisible (`3 Tr`) text — the same
  rendering-mode-3 technique PhantomLint's metamorphic check (extracted text vs. OCR of the
  rendered page) was built to catch for page content — but inside an annotation's or a form
  field's own appearance stream rather than the page's content stream. Whether PhantomLint's
  published detector specifically walks annotation/widget appearance streams the way poppler's
  `pdftotext` does (measured directly for this project's own injector output — see
  [`docs/limitations.md`](limitations.md#image_only--freetext_annot--acroform_field--info_dict-caveats-round-3-probes))
  was not checked by this project; PhantomLint's paper was read for page-content channels only.
  The expectation is that both are *plausibly* detectable by the same class of tool, for the same
  reason `white_text`/`render_mode_3` are — real, extractable text that just isn't painted — but
  that is unverified here.
- **`info_dict`** places the payload in the classic `/Info` dictionary (`Subject`/`Keywords`), a
  channel with no counterpart in PhantomLint's own extracted-text-vs-OCR check (which compares
  page text, not document metadata). Whether any hidden-text scanner inspects `/Info` at all is a
  distinct, also-unmeasured question.
- **`image_only` is the odd one out.** It rasterizes the instruction to a visible image stamp, so
  it defeats every text-extraction-based scanner (PhantomLint included) by construction — there is
  no text object to extract — but it is trivially visible to any human who looks at the page, the
  same non-covert trade-off `visible_positive_control` already makes. It measures whether a
  provider's ingestion has a vision path, not whether a hidden channel evades detection, and it is
  not positioned as a stealthier alternative to `white_text`/`render_mode_3`.

## 5b. Raster Guard: where the pixel channel sits relative to this literature

Round 4 added [Raster Guard](raster-guard.md), which paints its notice into the page bitmap after
rasterizing the document. It changes this page's picture in one specific way and leaves the rest
untouched.

**What is structurally true.** Every channel in [§3](#3-what-is-already-covered-by-prior-work)'s
inventory — CrackedPDFs' 14 families and the EG01-EG25 extraction-gap taxonomy alike — is a
*document-object* channel: each one works by making a text extractor and a renderer disagree.
Rasterization removes the text extractor from the path, so it removes all of them at once. A payload
applied after rasterization is not in that inventory because it is not the same kind of object.

The same holds for the deployed detectors, which is the part worth checking before repeating any
claim here. Zhang et al. (2026) measured hidden prompt injection across 196,682 de-identified
resumes (roughly 1% carried one) using two detectors now running in hireEZ production: **HCD**,
whose rule stage inspects each *text element extracted from the PDF* (font size under about 4pt,
RGB colour distance to the sampled background under 15, rendered pixel-intensity standard deviation
under 3.0, ink density under 1.5%; estimated precision 86.1%), and **VDA**, which flags text
"present in the extraction but absent from the rendered images" (estimated precision 92.7%). Both,
like PhantomLint's metamorphic check, are built on an extraction-vs-render discrepancy, and a
guarded PDF gives neither an extraction side to work with.

**That is not a claim of undetectability, and this page must never be cited as one.** A pixel-domain
scanner finds the notice immediately, because the notice is printed on the page in plain sight.
**SnapGuard** (Du et al., 2026, preprint, submitted to ACM Multimedia '26) is exactly that scanner:
it thresholds grayscale intensity at 240 to mask near-white regions "where low-contrast text may be
difficult to recover", then applies contrast-polarity reversal to surface it before extraction. The
subtle tier's watermark composites to roughly `#dbdbdb` on white, inside the band that technique
exists to amplify.

**What is not novel.** Rasterized-image payloads as such. This project's own `image_only` probe mode
already stamped one, and scored 0/5 against `gpt-5.6-luna` (see
[§ Round-3 probe modes](#round-3-probe-modes-detectability-expectation-not-a-measured-result)).

**What was not found in the three nearest neighbours**, stated with this page's usual caveat that
"not found" is not "verified absent" and that no systematic search was run for this feature:

1. **Sizing a payload from published per-provider ingestion geometry.** Adjacent to, and arguably an
   application of, Semantic Integrity Failures' conclusion that exposure is driven mainly by the
   ingestion stack — position it that way, never as an independent discovery. The *inverse* is
   established prior art: Trail of Bits' image-scaling attacks (2025), building on the 2020 USENIX
   image-scaling work, and the Chameleon follow-up hide a payload that only materialises after the
   vendor's downscale. Raster Guard deliberately does not do this (see
   [`raster-guard.md`](raster-guard.md#3-honest-positioning-against-prior-work)).
2. **Preferring low-frequency (large, faint) over high-frequency (small, dark) payload placement.**
   Standard signal processing applied to this problem; novel as a design choice here, not as a
   result.
3. **Policy-framed rather than adversarially-framed instruction text.** The hypothesis that this
   outperforms imperative phrasing under instruction-hierarchy defenses is **unmeasured by this
   project** and must not be repeated as a finding.

**What has not been measured at all.** No provider matrix has been run against guarded PDFs. Every
coverage number the Raster Guard UI shows is a prediction from vendor documentation. Before any
Raster Guard result is cited anywhere, run the six-condition protocol in
[`research-protocol.md`](research-protocol.md) against guarded outputs and report the numbers, not
the prediction.

## 6. How to keep this page honest

Before this page, or any derived material, claims novelty for anything about this project, do all
of the following:

- [ ] Re-check whether CrackedPDFs, PhantomLint, or Semantic Integrity Failures have moved from
      preprint to a refereed venue since 2026-08-22 (re-fetch each arXiv abstract page — a venue
      line appearing there, or a published DOI, is the signal to watch for).
- [ ] Confirm the Rao/Kumar/Lakkaraju/Shah PLOS ONE DOI still resolves and still matches the title/
      author list cited by this project's PRD.
- [ ] Run a proper systematic search (not two web searches) before publishing any claim of the form
      "no prior work does X" — this page's [§4](#4-what-remains-open-as-far-as-this-projects-search-found)
      is explicitly a "found nothing so far" list, not a "verified absent" list.
- [ ] Re-verify the AIES 2026 / ICLR 2026 acceptance claims independently before repeating them
      outside the PRD's own citation — this page has not done so.
- [ ] Re-run the six-condition measurement in [§5](#5-detectability-finding-and-what-it-implies) if
      the provider, model id, or PDF fixture changes — a single-document, single-provider result
      does not generalize, and this page should say so every time it is cited.
- [ ] Never restate Raster Guard's structural detectability property as "undetectable". The correct
      statement is narrow: the extraction-vs-render family (PhantomLint, HCD, VDA) has nothing to
      compare on a text-free PDF, while a pixel-domain scanner (SnapGuard, or any contrast-normalising
      OCR stack) reads the notice immediately.
- [ ] Re-check whether SnapGuard and the Zhang et al. resume-screening measurement have moved from
      preprint to a refereed venue, and whether HCD/VDA have been extended to scan rendered pixels —
      that extension would remove the structural blindness this page relies on.
- [ ] Never cite a Raster Guard coverage figure as a measurement. Until a provider matrix is run
      against guarded PDFs, every one of them is a prediction from vendor documentation.
- [ ] Never restate "PhantomLint detects our two channels" as "our channels are always caught" —
      state the exact numbers (100% recall, 0.092% FPR on ICML 2025 papers) and the exact scope
      (white text, render mode 3) every time.

## See also

- [`README.md`](../README.md#what-this-is-not) — product framing and what this project is not
- [`docs/ethics-and-privacy.md`](ethics-and-privacy.md) — governance rules, manifest handling
- [`docs/limitations.md`](limitations.md) — per-mode caveats, including `unicode_tags`' Cf-category
  filtering and the Raster Guard caveats
- [`docs/raster-guard.md`](raster-guard.md) — the post-rasterization pixel channel and its own
  novelty assessment
- [`docs/research-protocol.md`](research-protocol.md) — how to reproduce or extend the six-condition
  measurement cited in [§5](#5-detectability-finding-and-what-it-implies)
