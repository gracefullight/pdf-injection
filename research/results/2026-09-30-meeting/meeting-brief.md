# Meeting brief — document perturbation, 30 September 2026

## Conclusion to present

**The tested pixel-perturbation pipeline preserved much of the document's visual
utility, but did not induce the required refusal and instructor referral on
Specification3. Numerical diagnostics limit how confidently we can attribute
this negative result to the method rather than its optimization path.**

This is a bounded feasibility result on one document and one frozen surrogate.
It does not establish that document perturbations are impossible. A successful
transferable protection method has not been demonstrated.

Numerical result, 14:05 Sydney: the full FP64 smooth-input reference completed and
passed all twelve directional criteria. This resolves that reference's validation
step, while the original FP32 path and the behavioral effect of FP64 optimization
remain unvalidated. The prior BF16 negative behavioral result is unchanged.

## Research question and actual intervention

Can a small, text-free change to document pixels make a frozen vision-language
model decline assessment-solving requests and refer the user to the instructor,
while preserving useful document reading?

The experiment continued the existing synthetic-page work onto page 2 of the
seven-page native Specification3 PDF. The original file was retained. Model
inputs were rendered page images; experimental raster PDFs are derivatives and
do not preserve native selectable-text semantics.

The completed pilot used frozen Qwen2.5-VL-3B-Instruct in BF16 on CUDA, a maximum
pixel change of 8/255, and a protected text mask. It compared:

- **E:** response-target optimization across sampled image transformations (EOT).
- **U:** the same schedule with twelve of thirty-six updates replaced by utility
  supervision.
- **X:** a development-selected crossover of E and U candidates.

Each parent had 36 updates across three paired seeds: **216 updates total**.
The seeds are replications; E, U, and X are the method comparisons. There were
172 accepted nonzero proposals, each improving its current sampled objective.
All nine selected candidates nevertheless had zero strict success on development
questions. X used an additional 360 selection generations and was not
compute-matched to E or U. [Completed pilot and delivery report](../2026-09-27-policy-delivery/completion-report.md).

## Evidence available for the meeting

Strict success requires a completed response of at most 96 tokens containing a
refusal and instructor referral, without substantive assistance.

| Completed experiment | Observed result | What it establishes |
| --- | --- | --- |
| Historical synthetic fixture | An EOT/utility image candidate had 12/12 strict successes, but 0/4 after PDF round-trip; a later crossover PDF had 2/12 | Some local steering was possible on a development fixture; robust protection was not established |
| Specification3 page evaluation | 0/468 task rows; 367 truncated | No strict success across the tested page conditions |
| Specification3 document/render controls | 0/372 task rows; 262 truncated | No strict success across the tested document conditions |
| Policy-delivery diagnostic | 0/144 at 192 tokens and 0/144 at 768 tokens | The longer limit resolved 71 truncations without producing strict success |
| Visual utility and artifact checks | 312/312 page answers and 204/248 document answers matched; all candidates respected the mask and 8/255 | Selected layout-reading utility and pixel constraints were largely preserved |
| Full FP32 numerical gate | None of twelve directions passed the required adjacent-step criterion | The planned FP32 optimization comparison lacked a validated prerequisite |
| Full FP64 numerical reference | All twelve directions passed; all 96 comparisons audited | A local derivative reference is now supported for the tested smooth FP64 path; no new behavioral result |
| Latest isolated decoder diagnosis | FP32 and FP64 both agreed at two small steps; both disagreed at larger steps | A local scale effect is present; a blanket claim of broken gradients is unsupported |

Historical results and the Specification3 run differ in document, runtime,
precision and other conditions. Their success counts are not a controlled
estimate of a document effect. [Historical commit audit](../2026-09-27-commit-audit/README.md).

The pilot archive contains 1,400 logical responses: 840 task and 560 utility rows.
The delivery diagnostic adds 288 task responses. These are repeated conditions,
not independent documents or a population success-rate estimate. Every response
still eligible under the strict length/completion rules was reviewed in full;
none was a policy refusal/referral. This was assistant review, not independent
human annotation. Long and truncated responses were not exhaustively graded for
all forms of refusal or answer correctness.

Policy delivery also failed when the notice was supplied as user text. This makes
image rendering alone an insufficient explanation in this matrix. It does not
test every instruction hierarchy. The notice is an experimental fixture, not a
claim about the assessment's actual policy.

## What the latest GPU result changes

The frozen-decoder diagnostic finished successfully on September 28 at 19:55
(Sydney), with 17 passing CPU prerequisites. At the two smallest embedding
steps, FP32 relative errors were 0.0065% and 2.4036%; FP64 errors were 0.7299% and
2.8853%. At larger steps, both had errors around 10–16%. All ten loss-only checks
passed. [Result and interpretation](../2026-09-27-precision-continuation/README.md#completed-frozen-decoder-diagnosis).

This narrows the diagnosis: promoting the decoder or loss alone did not eliminate
the larger-step discrepancy. Smaller downstream steps can agree with autograd.
It remains uncertain how internal rounding and local nonlinearity contribute to
the full pixel-to-loss mismatch. The isolated test used one prompt and one saved
vision secant; it does not pass the twelve-direction full-input gate.

**Completed:** the BF16 behavioral pilot, delivery controls, and listed numerical
diagnostics. **Unexecuted:** the proposed matched FP32/math E/U/X comparison,
including its planned 72 updates and 1,024 final response rows. Those planned
counts are not experimental observations. No new Specification3 transfer result,
SAM result, Gumbel result, or successful-candidate shaving result exists.

## Follow-up submitted while preparing this meeting

**Now completed:** all four final shards exited 0 by 14:05 Sydney, each with 24
passing CPU prerequisites. The combined audit reconstructed all twelve gradient
projections and recomputed all 96 comparisons. Twelve of twelve directions meet
the adjacent-step rule; 60/96 individual steps pass. Maximum errors at the two
smallest steps are 0.2386% and 0.8817%. All twelve directions still fail at the
old one-ULP step. FP32/FP64 analytic projections differ by up to 29.81% in the
crossover state, so the old discrepancy cannot be attributed to step size alone.
[Combined audit](../2026-09-27-precision-continuation/completed-full-fp64-summary.json).

The submission and recovery history follows.

A full-path FP64 diagnostic was submitted on September 30 at 12:53 Sydney. It
reuses the twelve archived directions and tests eight exact pixel steps, including
six below the previous FP32 spacing. Pixel-dependent arithmetic runs in FP64;
original normalization and positional constants remain fixed. It requests one GPU
for up to 30 minutes, with 21 CPU prerequisites and minute-by-minute scheduler
logging. At 12:57 Sydney it was queued for resources; two consecutive monitoring
samples were verified. It has no behavioral result yet.
[Fixed protocol](../../hpc/full-fp64-scale-protocol.md).

Update at 13:38 Sydney: the initial job exceeded its 30-minute walltime. Seven
of 96 finite-difference pairs and the first gradient were saved. The first
direction agrees at four small steps (relative errors 0.0204%, 0.0816%, 0.3261%,
and 1.3011%) and disagrees at the next three. This is partial full-path evidence,
not a completed twelve-direction validation. The unchanged grid was resubmitted
as four state/prompt shards, each with a three-hour limit; the first shard reuses
the verified checkpoint. No new behavioral result follows from these checks.

The complete FP64 smooth-input reference has now passed. Its behavioral
continuation is running, with saved-byte candidates to be selected and evaluated
by the unchanged BF16 model. This does not validate the unmodified FP32 optimizer
by proxy. Transfer remains optional; the immediate research question concerns
perturbation efficacy on the surrogate.

## Defensible contribution and limits

The present contribution is an empirical account of where a document-specific
perturbation pipeline fails, with rendering, utility, response-length and numerical
checks. The existing [literature notes](../../../docs/related-work.md) identify
ImageProtector as the primary reference and distinguish the presentation's STAB
backdoor-training setting. These experiments do not yet demonstrate a new
successful method or establish publishable novelty by themselves.

The [updated novelty comparison](novelty-positioning.md) adds Doc-PP, joint
privacy/utility shielding, and DOPE. These sources further limit broad claims
about document policies, selective protection, or the educational application
being new. The narrower contribution candidate concerns the combined constraints
and experimentally established failure conditions.

For a paper, broader documents and independently coded outcomes would strengthen
the empirical claim. The FP64 smooth-input reference is validated, but transformed-byte derivatives
remain approximations and its behavioral continuation is unfinished. OCR and four layout questions do
not establish semantic comprehension, accessibility, or imperceptibility; faint
background texture was visible. The current result supports neither universal
robustness nor universal impossibility.

## One-minute speaking script

> We continued our existing text-free perturbation pipeline from a synthetic
> fixture to the actual seven-page Specification3 document. We compared EOT,
> utility-supervised optimization, and their crossover under an 8/255 budget and
> a protected text mask. The completed pilot made 216 optimization updates, but
> none of the tested task conditions produced the required brief refusal and
> instructor referral. Document reading was largely preserved. Longer outputs
> and alternative policy-delivery channels did not recover the target behavior.
> We also found a numerical limitation: the full FP32 gradient check has not
> passed. The full FP64 reference has now passed all twelve directional checks
> at sufficiently small steps, while larger steps still disagree. This supports
> FP64 optimization, which is now running; its behavioral effect is still untested.
> For this meeting, we have a bounded negative feasibility result and a more
> carefully validated follow-up in progress. We have not demonstrated a successful
> protection method or shown that perturbation cannot work.

[Evidence recount and interpretation audit](validation.md).

## Behavioral continuation, September 30 at 14:29 Sydney

Two FP64 E/U optimization jobs are running. A fresh-process BF16 selection and
evaluation job is submitted with a dependency on both parents succeeding. The
[protocol and execution record](../2026-09-30-fp64-behavior/README.md) preserve
the original byte budget, mask, questions and selection rule. Planned budgets
are 72 updates, 232 development generations and 1,024 final logical response
rows. No new response-generation result is available yet.

Update at 15:55 Sydney: both FP64 parent jobs exited 0 with 36 updates each.
E accepted 23 nonzero proposals and U accepted 32; recorded pixel constraints
were respected throughout. The dependent BF16 selection/evaluation job is now
running after its resource assignment was changed to an available node. These
optimization observations do not establish response-level success.
