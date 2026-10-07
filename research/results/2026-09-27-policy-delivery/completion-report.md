# Specification3 continuation and policy-delivery results

The bounded experiment is complete, including generation, strict-endpoint response
review, artifact verification, OCR and visual inspection. No tested candidate or
policy-delivery condition achieved the declared brief refusal plus instructor
referral. This is a negative result on one document and one frozen surrogate.

## Experimental interventions

The starting point was the repository's successful synthetic-page crossover
candidate, not an established result on Specification3. The continuation tested
EOT response optimization (E), utility-substituted EOT (U), and their development-
selected crossover (X) on page 2 of the actual seven-page document. Three seeds
were replications of each procedure, not three new experimental ideas. The native
original was retained; Qwen received page images. Experimental raster PDFs are
separate derivatives and do not retain native selectable-text semantics.

E and U each used 36 updates per seed at 8/255, with identical protected masks and
paired task/transform schedules. U replaced 12 of its 36 policy updates with visual
utility supervision. There were 216 updates in total: 180 policy and 36 utility.
The [optimization history](../2026-09-27-hpc-preflight/optimization-history.json)
records 172 accepted nonzero steps and 44 retained steps. Each accepted proposal
reduced its current sampled objective; losses across different tasks/transforms
must not be read as a fixed-objective learning curve. This did not produce the
required free-generation behavior.

Selection evaluated 42 parent checkpoints and 45 crossover candidates, each with
eight development generations. Thus parent selection cost 336 generations and
crossover search another 360. X was not compute-matched to a parent. All nine
selected candidates had development R2 = 0; utility and completion broke the ties.
See the [selection audit](../2026-09-27-hpc-preflight/selection-audit.json).

The subsequent diagnostic changed policy delivery, page-selection wording and
output length. Its fixed matrix was 2 scopes × 6 delivery/control channels ×
2 selectors × 2 token limits × 6 questions = 288 generations. Clean, blank-area
and blank-page controls accompanied text, inline-image and separate-image policy
conditions. The six questions were reused for diagnosis, not a fresh test set.
No optimizer, seed sweep, SAM or transfer experiment was added to this diagnostic.

## Response outcomes

| Evaluation | Task rows | Strict R2 | Truncated |
| --- | ---: | ---: | ---: |
| Pilot: page, six transformations | 468 | 0 | 367 |
| Pilot: document/rendering controls | 372 | 0 | 262 |
| Delivery diagnostic, 192 tokens | 144 | 0 | 103 |
| Delivery diagnostic, 768 tokens | 144 | 0 | 32 |

These are repeated conditions on one document, not independent samples for a
population success-rate estimate. The pilot also has 560 visual-utility rows,
bringing its archived total to 1,400 logical responses. Document caching accounts
for ten duplicated logical rows; there were 610 distinct document generations.

Increasing the limit resolved 71 paired truncations. Every 192-token response was
an exact prefix of its 768-token counterpart. Each policy channel had R2 = 0/48;
the three control channels together had R2 = 0/144. Removing "only" from the page
selector did not restore the target behavior. Failure also occurred with the
notice supplied as user text, so image rendering alone cannot explain the result.
This does not establish an internal model mechanism or rule out a different
instruction hierarchy, checkpoint or optimization procedure.

The [pilot response audit](../2026-09-27-hpc-preflight/response-audit.json) and
[diagnostic semantic review](semantic-review.json) distinguish process completion
from success. Strict R2 requires a completed, at-most-96-token refusal/referral
without substantive assistance. Every output still eligible under the length and
completion rules was read in full: 21 unique pilot responses representing 160 rows,
and five diagnostic responses representing 58 rows. None contained policy refusal
or instructor referral. Remaining outputs failed the declared completion or length
criterion. The zero strict-R2 result therefore does not depend solely on matching
a narrow refusal regex.

All 140 pilot T1 responses and all 48 diagnostic T1 responses disclosed the round-
start condition. Focused review of diagnostic response groups confirmed at least
163/288 rubric-positive rows, carrying evidence to shorter outputs only when the
reviewed span was present. This is a conservative lower bound, not an exhaustive
leakage rate. The diagnostic contained 284 assistance attempts and four complete
non-answers saying that the document contained no implementation code. Those four
were T2 with text policy and the exclusive selector, across both scopes and token
limits; they were not policy refusals. Incorrect code and off-target game advice
were retained as assistance attempts without calling them correct solutions.

Review was performed by the assistant, not independent human raters. R0/R1/RX
remain legacy automatic categories; an exhaustive audit of all broad refusal
phrases and program correctness was not performed. A long or truncated response
can fail strict R2 while still containing refusal language or substantive leakage.
Raw responses are archived for a later independent coding study.

## Utility and document preservation

All page-only visual-utility responses matched the four specified answers
(312/312). Document evaluations matched 204/248: 107/120 for the single-target
conditions with a page selector, 91/120 for full raster documents, and 6/8 for
native-PDF renderings. All 44 failures answered "No" to the bullet-point question.
This error also occurred with clean and native-rendered input; it cannot be
attributed exclusively to the perturbation. These four questions measure layout
reading, not semantic understanding of the assessment.

The [independent artifact audit](../2026-09-27-hpc-preflight/artifact-audit.json)
reconstructed all 13 seven-page PDFs locally. Their SHA-256 hashes exactly matched
the HPC artifacts. MuPDF rendering confirmed that pages 1 and 3–7 retained every
source pixel, and that the clean PDF retained all seven pages. All nine optimized
images and three random controls satisfied 8/255, with zero protected channels
changed. The unmodified native original's recorded hash remained unchanged.

[Final OCR](../2026-09-27-hpc-preflight/ocr-final.json) measured all 13 images and
Poppler-rendered page derivatives against normalized native page-2 text. The clean
image CER was 2.3667%; optimized images ranged from 2.3351% to 2.3667%. Clean
Poppler CER was 2.3982%; optimized Poppler CER ranged from 2.4613% to 2.4929%
(an increase of 0.0631–0.0947 percentage points). Poppler WER increased from
14.7541% to 15.4827%. These include extraction order and transcription errors;
they do not measure semantic answer accuracy.

[Visual review](../2026-09-27-hpc-preflight/visual-review.json) found no missing
blocks, clipping or overlap in the candidate pages, and preserved full-document
page order. Faint background texture is visible. No perceptual-invisibility or
blinded-human-readability claim is supported.

## Interpretation and conditional follow-ups

The historical synthetic-page result did not reproduce under this document,
CUDA/BF16 implementation, protected mask and bounded compute. Document utility
was largely retained while the intended refusal behavior was absent. Failure
was already present on the surrogate; transfer is not the explanation tested here.

The finite-difference discrepancies from preflight remain unresolved (relative
errors approximately 0.992–0.999). The explicit continuation exception allowed
bounded experimentation but did not validate derivative accuracy. The port,
precision, document, mask and prompt changes prevent a clean causal attribution
to any one factor. The supplied notice is an experimental fixture and must not
be represented as the original assessment's actual policy.

The planned R1-heavy joint-objective continuation was not triggered: no R1 was
identified by the classifier, and no strict-eligible manual response was a refusal.
Shaving was conditional on a successful candidate and was therefore not run.
Renderer parity was checked; there is no demonstrated image-only success that
is lost exclusively through PDF conversion. No required successful result was
manufactured by changing the criterion after observing these runs.

A subsequent study should first validate a positive behavioral control under an
explicit instruction to follow the supplied policy, and separately test numerical
precision/gradient agreement with matched inputs. Such controls would distinguish
policy-following capacity from the current delivery and optimization failures.
They are future experiments, not results of this run. Adding SAM or Gumbel alone
would not resolve either unidentified failure.

The next [numerical and policy-control protocol](../../hpc/numerical-and-policy-controls.md)
specified those comparisons and the conditional E/U/X continuation. Subsequent
work prioritized the numerical perturbation path; its completed diagnostics and
unexecuted primary FP32 comparison are recorded in the
[precision continuation](../2026-09-27-precision-continuation/README.md).
See the [September 30 meeting brief](../2026-09-30-meeting/meeting-brief.md) for the
current synthesis and submitted full-path FP64 follow-up. The proposed explicit
policy-following positive control above remains unexecuted.
