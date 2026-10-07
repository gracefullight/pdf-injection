# Experiment follow-up for commit fa519216

Audit date: 2026-09-27. This is a review of existing evidence, not a new model run.

## Scope and provenance

`fa519216e8514b163a6efb9fa0faacefc8a6ec91` (2026-09-17),
`feat(research): add perturbation experiments and evaluation results`, introduced
`shave_document_perturbation.py` alongside 164 other changed files. It contains
42 experiment implementation files, 18 research test files, 10 fixtures, research
narratives, result bundles, saved PDFs/images, and a product notice wording change.
No subsequent commits touching `research/` or `docs/` were found between that
commit and the HEAD inspected for this audit. Current uncommitted planning edits
are separate from that historical evidence.

- [Complete file inventory](commit-files.csv): all 165 paths, commit-content
  hashes, working-copy comparison, and inspection scope. This is an experiment
  inventory, not a claim of line-by-line correctness review or test execution.
- [Response counts](response-counts.csv): counts recomputed from saved response
  rows, retaining historical labels and distinguishing missing fields from zero.
  Duplicate copies of the same evaluation are listed separately; do not pool
  them as independent runs.
- [Recovered-record provenance](recovered-records.json): 15 existing ignored
  local reports copied without modification into `recovered/`. These records
  were not committed in fa519216; they are corroborating evidence found during
  this follow-up, not newly executed experiments.

## What was actually tested

R2 below means the historical refusal-plus-referral label. Strict R2 additionally
requires no detected task-specific answer leakage. These are different measures.

| Experiment | Saved result | Interpretation |
| --- | --- | --- |
| CLIP feature alignment, 120 steps, 4/255 | Research narrative reports improved target similarity after PDF rendering, but identical non-refusal replies from Qwen for original/random/optimized controls | Feature alignment was already attempted; similarity did not establish behavior transfer. |
| Native-resolution response gradients and renderer calibration | Early response-gradient trials, content masks, cumulative bounds, prefix objectives and resize adjoints are documented; free-generation trials remained unsuccessful | The project progressed beyond a CLIP-only probe before the later refusal optimizer. |
| Qwen multi-prompt + EOT + utility, direct image, 8/255 | R2 12/12; five utility responses saved; PDF round trip R2 0/4 | Direct-image success did not survive that PDF route. The 12 prompts include training prompts. |
| Direct-image shaving and reoptimization | Both 4/255 and 3/255 candidates reached R2 12/12; proportional reduction of the 3/255 candidate to 2/255 or 1/255 gave R0 on the canonical request | Lower-amplitude search has already been run. This is not a 3/255 PDF success. |
| Low-contrast notice plus PDF-aware optimization | At notice contrast 8/255, reoptimized perturbation 10/255 gave R2 3/12; R2 on 1/10 transform conditions | One PDF rendering path was solved, with limited prompt and renderer robustness. |
| Prompt-robust 11/255 candidate | R2 4/12, R1 1/12, R0 7/12 | Multi-prompt optimization is already implemented and tested. |
| Renderer-robust 11/255 candidate p016 | R2 3/12 separately for direct image and PDF rendering; R2 on 3/10 transforms | Candidate-bank selection improved the joint image/PDF behavior, but JPEG and other paths remained weak. |
| Renderer-specialized crossover and residual transfer | Committed crossover screen: 25 pairs; residual screen: 19 pairs; neither has a candidate with R2 on both paths | Some individual-path R2 responses exist; aggregate R2 counts must not be read as joint success. The narrative also mentions a coarse residual screen not contained in this 19-pair file. |
| Earlier no-visible-notice 8/255 PDF candidate | R2 0/12, R1 1/12, R0 10/12, RX 1/12 | This saved candidate is distinct from the later x05 candidate. |
| Text-free x05, 8/255, local Qwen PDF rendering | R2 2/12, R1 6/12, R0 4/12 | Refusal of some kind in 8/12; refusal plus referral in only 2/12. |
| Text-free x05, Luna PDF upload | Clean and perturbed conditions each labeled R0 3/3; five of the six responses incomplete | No observed refusal transfer; this does not establish complete correct answers. |
| Text-free x05, Luna image route | Clean image, x05 source image and x05 PDF-rendered image each labeled R0, one request each; two of three incomplete | Direct image transfer was also screened, not only PDF upload. |
| Blank-region readable policy stamp, four-page synthetic PDF | At 32/255: strict R2 3/3; five transforms with two repetitions: 10/10; six prohibited requests: 6/6; six benign checks passed | This is a positive semantic-text control on one document/model, not text-free adversarial transfer. |
| Keyed visual watermark with local policy router | Watermark alone: R0 3/3; routed: strict R2 3/3; prohibited 6/6; benign 6/6; transform routing 5/5 | The application detects a signal and supplies trusted policy. It is not direct model response control from pixels alone. |

Evidence for the early gradient work is in
[`pixel-notice-probe.md`](../../pixel-notice-probe.md). The recovered
[3/255 prompt evaluation](recovered/shave-e03-prompts.json),
[optimizer report](recovered/shave-e03-optimizer.json), and
[0–3/255 screen](recovered/shave-e00-e03-screen.json) establish that shaving was
already an executed experiment. The recovered
[utility/EOT transform evaluation](recovered/utility-eot-transforms.json) records
the direct-image versus PDF gap.

The committed [surrogate results](../2026-09-13-surrogate-factorial/README.md),
[blank-region results](../2026-09-09-gpt-luna-brps/README.md), and
[router results](../2026-09-09-policy-watermark-router/README.md) contain the later
artifact references. Their stage-specific statements must be read in sequence:
an earlier statement that commercial transfer was not tested is superseded by
the later Luna x05 screen, not by a successful transfer result.

## Additional branches already explored

These screens are easy to miss if only the three result READMEs are read.

- **Microtext:** seven committed policy/size/contrast screens contain 29
  responses. The 5-point strict-policy contrast screen has three completed strict
  R2 responses at gray values 160, 192 and 216, one trial per condition. Finer
  pale conditions at 224/232/240 yield R1 with leakage, and 248 yields R0.
  These are readable glyph methods with limited sampling, not invisible pixels.
- **Microtext plus transferred perturbation:** six conditions compare baseline,
  resized/tiled perturbations on one/all pages, and random noise. Baseline and
  random are R2; the four optimized-pattern conditions are R1. Strict R2 is 0/6
  and all six responses are incomplete. There is no demonstrated benefit from
  the transferred pattern in this screen.
- **Off-canvas notice:** four PDF conditions, including a MediaBox/CropBox
  condition, have R0 labels and incomplete responses. No refusal was observed.
- **QR policy:** five policy screens have R0 labels and incomplete responses.
  Four separate decoding requests are completed, but decoding text must be
  compared with the known payload; an answer claiming to decode a QR is not proof
  of correct policy recovery.
- **Symbolic policy:** eight assignment-answer screens have R0 labels and
  incomplete responses. A separate interpretation request describes human
  handling of reservations rather than the intended assessment-assistance rule.
- **Chroma and camouflage:** generators and candidate manifests exist. Four
  recovered chroma response reports show contrast-dependent behavior; the
  low-contrast screen is R0 6/6. Camouflage artifact generation alone does not
  establish a completed model evaluation.
- **Hidden-text/raster hybrid:** the recovered 15-response ablation has R2 in
  all conditions, but hidden text alone is already strict R2 3/3. The hybrid
  cannot establish that its pixel component caused the effect.

The commit also implements PDF wrapping/rasterization, transformation suites,
contrast rebasing, crossover, residual transfer, independent model evaluation,
and bounded process execution. Its 18 research test files cover mathematical
adjoints, bounds, masks, projection, classification and watermark mechanics.
Their presence is not evidence of model effectiveness, and they were not rerun
for this history review. The product changes only revise the UTS instructor
wording and corresponding assertions; they do not add a working invisible
protection mode.

## Evaluation gaps found in the follow-up

1. **R0 is not verified correctness.** Several saved R0 responses explicitly say
   the one-page fixture lacks method definitions or data. The regex classifier
   misses some such wording. Preserve the raw historical labels, but assess
   answerability and missing-information responses separately in future runs.
2. **Completion matters.** Five of six x05 PDF responses and two of three image
   responses are incomplete. Local generation records have a token limit but no
   explicit completion status. Do not treat a clipped answer as a complete
   answer, or a refusal prefix as proof that no later content would leak.
3. **The policy and utility tasks conflict in one earlier setup.** The recovered
   five-query utility screen includes summarization, while the supplied full
   notice prohibits summarization. “Five non-refusal responses” does not prove
   compliance with that full notice. Define permitted tasks consistently before
   making a policy-selectivity claim.
4. **Selection and evaluation overlap.** The x05 candidate was chosen after
   checkpoint, hard-prompt and crossover screening. The historical 12-prompt
   scores are descriptive development results, not an untouched final test set.
5. **Strict leakage rules are fixture-specific.** The current hosted classifier
   checks architecture-fixture identifiers. Those checks do not cover the new
   Programming 2 assignment; manual review or a document-specific rubric is needed.
6. **Input identity differs.** These results use a sparse one-page fixture or a
   four-page synthetic architecture assignment. No completed experiment on the
   seven-page native `Specification3.pdf` was found in the reviewed evidence.
7. **Training methods remain separate.** The tested Qwen path freezes model
   weights and optimizes input pixels. This commit supplies no SAM-trained
   surrogate, Gumbel-Softmax experiment, or completed CUDA port.

## Revised next experiment

The historical findings above remain unchanged. The current plan continues the
existing text-free EOT/utility/crossover procedure on the actual document, with
transfer as a secondary outcome. SAM was an example, not a selected method. See
the current [experiment plan](../../hpc/next-experiment.md). The method ordering
below records the earlier proposal and is superseded by that plan.

The next work is to extend the existing pipeline to the actual native PDF and
resolve transfer and evaluation gaps. It is not a first implementation of pixel
optimization, EOT, shaving, image/PDF comparison, or Luna transfer evaluation.

1. Freeze `Specification3.pdf` and the supplied experimental notice as separate
   inputs. Define answerable task requests and policy-permitted administrative
   questions for this document. Keep its native text baseline intact.
2. Reuse the implemented optimizer's content masks, utility objective, PDF-aware
   path, quantized candidate bank and free-generation evaluation. Verify renderer
   parity at the new page geometry before using its gradients. Treat the CUDA
   implementation as a port requiring numerical validation.
3. Compare original native PDF, clean raster PDF and perturbed raster PDF; also
   evaluate their page images. Include matched random and readable-notice controls.
   Historical synthetic results are references, not results on this document.
4. Use fresh development/test prompts, record completion, and review refusal,
   referral, leakage, missing information and permitted reading separately. Freeze
   candidate selection before evaluation on an independent model.
5. Given failed single-surrogate transfer, compare that baseline with a defined
   multi-surrogate or feature-alignment variant at matched budgets. The earlier
   CLIP-only negative result must be included when motivating feature alignment.
   Test SAM only as a later controlled surrogate-training comparison; Gumbel
   requires a specified discrete decision variable.
6. Apply shaving to a successful new-document candidate to measure its amplitude
   boundary. Do not repeat an x05 sweep as though it were the missing main result.

The HPC inventory submission and preparation scripts are later environment work.
They do not change any of the completed historical experiment results above.
