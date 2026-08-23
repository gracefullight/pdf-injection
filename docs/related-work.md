# Related Work

This page positions PDF Injection against the nearest published and preprint work on hidden
instructions in PDFs, states what each claim's peer-review status actually is, and marks what
this project's own search found to be open. It exists because novelty claims are easy to overstate
and hard to walk back once repeated — every claim below is tagged so a reader (or a future
contributor) can tell a refereed finding from an unrefereed one at a glance.

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
- [ ] Never restate "PhantomLint detects our two channels" as "our channels are always caught" —
      state the exact numbers (100% recall, 0.092% FPR on ICML 2025 papers) and the exact scope
      (white text, render mode 3) every time.

## See also

- [`README.md`](../README.md#what-this-is-not) — product framing and what this project is not
- [`docs/ethics-and-privacy.md`](ethics-and-privacy.md) — governance rules, manifest handling
- [`docs/limitations.md`](limitations.md) — per-mode caveats, including `unicode_tags`' Cf-category
  filtering
- [`docs/research-protocol.md`](research-protocol.md) — how to reproduce or extend the six-condition
  measurement cited in [§5](#5-detectability-finding-and-what-it-implies)
