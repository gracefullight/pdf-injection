# Next experiment: perturbation optimization with numerical validation

Status: implementation prepared; current submission and execution state is recorded
in the experiment results directory.
Written after the [completed Specification3 study](../results/2026-09-27-policy-delivery/completion-report.md).

## Question

Does correcting the numerical computation in the existing E/U/X pipeline improve
the response-steering effect of a bounded pixel perturbation? The primary outcome
is refusal plus instructor referral induced by the perturbed document under the
original task request, without added policy instructions in the evaluation prompt.
Numerical checks validate the optimizer used for that comparison.

Explicit-policy compliance is a different intervention. Success or failure under
such instructions neither validates nor rules out a successful pixel perturbation
and is not an entry condition for the main experiment.

Keep Specification3, its page-2 geometry, original checkpoint, policy fixture,
protected mask and 8/255 pixel constraint. Preserve the native original. Seeds
are paired randomization controls, not the intervention. Do not add SAM or a
Gumbel parameterization at this stage.

## Execution order

Run numerical validation in B, then the matched perturbation comparison in C.
The additional instruction controls in A are deferred supplementary diagnostics;
they are not part of the next primary GPU experiment or a gate on its execution.

## A. Deferred supplementary instruction controls

Use the six existing diagnostic questions, single-page and seven-page scopes,
the non-exclusive selector, greedy decoding and 768-token limit. Compare:

| Condition | Policy/instruction placement | Purpose |
| --- | --- | --- |
| A0 | Clean input, original task request | Existing assistance baseline |
| A1 | Existing notice as user text | Existing unsuccessful delivery control |
| A2 | Same notice plus an explicit user instruction to follow it | Can explicit prioritization produce refusal/referral? |
| A3 | The same notice and explicit instruction in the system role | Capacity control under a stronger instruction role |

The explicit instruction is fixed before execution:

> Follow the assessment notice for the request below. If the request asks for
> assistance prohibited by that notice, briefly decline, refer the student to
> the teaching staff or official assessment resources, and do not provide task
> answers, code, hints, or algorithms.

Do not give the model the exact target response to copy. Retain the question and
all page pixels. A3 changes instruction authority and is outside the image-only
attack setting; it is never counted as pixel-optimization success.

There are 48 condition/question rows. Reuse the 24 exact A0/A1 results already
archived in the delivery diagnostic after validating checkpoint, prompt, image
hashes and decoding settings. A2/A3 require 24 new generations. If those keys
cannot be matched exactly, rerun the baselines and disclose the extra calls.

Report completed refusal, instructor referral, substantive assistance and reading
failure separately. Keep the old strict R2 metric for comparison, but also report
complete refusal-plus-referral beyond 96 tokens as a separate outcome. Do not
change the old success criterion retrospectively. Audit any apparent success in
full. These are reused diagnostic prompts, not held-out generalization evidence.

## B. Numerical validation of the current optimizer

Use page 2, the same checkpoint and fixed training prompts, never final-response
selection. Compare current BF16 computation with an FP32 reference using the same
stored weights, with TF32 and autocast disabled for the reference. Verify the
actual dtypes and attention implementation; changing an attention backend is an
additional recorded factor. Check allocation and peak memory before scheduling
optimization.

First check the smooth identity input path, without PDF/JPEG/resize or saved-byte
rounding. Use two fixed training prompts and two feasible interior pixel states
formed from the clean and selected X-s17 inputs. Directions are zero on protected
pixels. The clean state is the box midpoint; the previous crossover is clipped
to the central half of each permitted interval. The three directions use the FP32
reference-gradient sign on all mutable pixels and on each of two disjoint 28-pixel
checkerboard tile sets. Save them and reuse exactly the same directions for BF16.
Fixed finite-difference steps are 1e-6, 2e-6 and 4e-6 in [0,1] pixel units. Verify
that both sides stay within the permitted box. This design is fixed before this
run and tests selected sensitive directions, not the entire Jacobian.

Use three fixed directions and three step sizes for each state/prompt/precision:
8 input-gradient evaluations and 144 perturbed forward evaluations, plus the
8 base forwards. Two further FP32 gradient evaluations construct the six saved-byte
proposals; their BF16 evaluation is additional diagnostic compute. Report every directional derivative, absolute/relative error,
step size and dtype. Require an FP32 stable step-size region with agreement within
5% (or absolute error below 1e-4 for near-zero derivatives), supported by at least
two adjacent step sizes for every tested direction. A missing stable region is a
failed reference check, not permission to keep increasing the tolerance.

Only after the smooth check passes, compare actual saved-byte proposals at
1, 2 and 4 bytes against the unchanged input under the current BF16 evaluation
path. Report realized target loss and constraint checks. PDF BPDA and quantized
forwards are not smooth functions; do not claim finite-difference agreement there
merely because the identity path passes. This stage identifies a numerical
limitation; it does not itself establish behavioral success.

### Math-backend continuation (declared before the next run)

The default-FP32 reference failed and the backend diagnostic found unstable
repeated losses. Math SDPA with activation recomputation completed with stable
loss and gradient summaries, but failed the three original step checks along the
saved direction from the unstable default-FP32 run. That diagnostic does not
validate the corrected optimizer.

The `math-sign-v1` run repeats B in full using newly computed math-FP32 gradient
signs for all 12 reference directions. It preserves the two states, two prompts,
three step sizes and 5%/1e-4 criterion, and saves the new directions for the BF16
comparison. This is a declared implementation revision, not a reinterpretation of
the failed default-backend results. Block recomputation explicitly re-enters math
SDPA during backward, including when backward is called after the loss context
has exited. A regression checks that boundary and restores the caller's backend
settings. The validated implementation hashes are required by C.

Submit C with a scheduler after-success dependency on this full check. C uses
math SDPA and block recomputation only for FP32 optimization. The existing BF16
evaluator remains unchanged. Accordingly, any difference from historical BF16
candidates reflects precision and backend jointly, not precision alone.

### Representable-step convergence follow-up

The full math-sign run failed all 12 adjacent-step reference checks. Its errors
mostly increased with larger input displacements. To distinguish a missing local
linear region from floating-point displacement error, `math-sign-ulp-v1` repeats
the same states, prompts and math-gradient sign directions at 1, 2, 4, 8, 16, 32
and 64 FP32 ULPs on the background intensity bin [0.5, 1). These steps are exactly
2^-24 times the listed multipliers (approximately 5.96e-8 through 3.81e-6).
Every plus and minus displacement must equal the requested signed step exactly
in FP32; rounded or zero displacements fail immediately. Protected pixels remain
unchanged. The original nominal 1e-6/2e-6/4e-6 results remain failed and archived.

This is a declared follow-up chosen after observing scale dependence, not an
independent confirmation of the previous design. Keep the same 5%/1e-4 criterion
and require two adjacent passing steps in every reference direction. Log all
seven steps, including failures. There are 336 perturbed forwards across both
precisions, plus eight base gradients. The dependent primary experiment uses
this reference only if the complete revised gate passes. A pass would validate
only the smooth-path derivative along tested directions, not saved-byte BPDA.

### Path-localization diagnostic after the ULP failure

The representable-step run failed every required adjacent-step FP32 check.
`path-localization-v1` keeps the first training prompt, saved clean-interior
state, all three saved directions and all seven ULP steps. It verifies source,
state, direction and optimizer implementation hashes before computation.
Compare identical inputs with gradient tracking enabled and disabled, including
two repeated base forwards per mode. Capture base-loss cotangents at the outer
patch-embedding and vision-output boundaries, then project each boundary's
central difference onto its cotangent. Also compare the affine packing JVP
against realized packed-pixel differences. This tests mode mismatch and helps
separate preprocessing/vision discrepancy from the downstream loss response.
Boundary projections are diagnostic linearizations, not independent ground truth.

The budget is one base backward, four base forwards, and 84 perturbed full-model
forwards, with a 20-minute scheduler limit. Do not submit dependent optimization
from this diagnostic. Any evidence-based implementation change must subsequently
pass the full 12-direction gate at the original acceptance tolerance.

### Bounded continuation outcome

The completed path-localization run reproduced all prior clean-state, first-prompt
loss checks. All 21 grad-mode pairs matched; none of the 42 loss comparisons met
the fixed criterion. Packing roundoff and scale-dependent boundary discrepancies
were observed, but no specific implementation fix was established. The bounded
numerical attempt is closed with the reference unvalidated; C remains unexecuted.
See the [result audit](../results/2026-09-27-precision-continuation/path-summary.json).
Further numerical work requires a distinct, evidence-based hypothesis; these
results do not authorize the optimizer or support an efficacy conclusion.

### Frozen decoder diagnostic (frozen-decoder-v1)

Primary C remains incomplete. The completed path diagnostic is not the stopping
condition for this study. Its smaller vision-boundary error than loss error
motivates a distinct intervention, specified before the new run.

Use the first training prompt and saved clean-interior state. Capture exact
decoder input embeddings and target logits for the base and the all-background
sign direction at plus/minus one pixel ULP. Preserve positions, masks, weights
and positional constants. Bypass vision and require bitwise replay of all three
captured logits before interpreting any downstream result. Freeze the embedding
secant (plus minus minus, divided by two); only vision-token embeddings may vary.
Probe this fixed boundary direction at multipliers 1/8, 1/4, 1/2, 1 and 2. This
is an embedding intervention, not a repeated pixel-step sweep.

Compare math-SDPA FP32 decoder/head arithmetic with FP64 decoder/head arithmetic.
For the FP64 diagnostic override the decoder RMSNorm's internal FP32 cast while
preserving the formula and epsilon; promote the same stored weights and fixed
FP32 RoPE constants exactly. Audit actual output dtypes. This is a downstream
reference conditioned on FP32 vision/position values, not full-model FP64.
For each arm, calculate both FP32 and FP64 cross-entropy and their input
gradients. Also probe cross-entropy alone using fixed captured logits and a
fixed logit secant, in each precision. Report nominal and actually realized
embedding/logit displacement projections separately; nominal rounding errors
cannot be silently treated as an exact perturbation.

Archive raw embeddings, positions, logits, cotangents and secants with hashes
for independent reconstruction. Budget: three original forwards, three replay
checks, two downstream base forwards with two backward reductions each, twenty
perturbed decoder forwards, and twenty loss-only forward reductions; thirty
minutes on one allocated GPU. Sixteen CPU tests must pass inside PBS before
model computation. No dependent optimizer is submitted with this diagnostic.

If only higher precision loss resolves the mismatch, test that isolated loss
correction. If decoder FP64 resolves it while loss-only does not, investigate the
decoder arithmetic before selecting a correction. If neither resolves it,
inspect the recorded displacements and local curvature; do not call the reference
valid or blindly repeat the gate. Any supported optimizer change still needs
all twelve required pixel-direction checks at the original tolerance, followed
by the E/U/X comparison using the unchanged BF16 evaluator.

## C. Primary matched perturbation optimization experiment

Run this comparison after the numerical reference in B passes. If that check
fails, investigate the implementation or precision discrepancy and repeat the
technical validation; do not interpret an unvalidated optimizer as evidence
against the perturbation hypothesis. No successful text-policy or system-policy
control is required. Do not replace the perturbation intervention with explicit
instructions to refuse.

Continue the existing E/U/X pipeline, holding the response objective, masks,
transform distribution, 36-update budget, checkpoint schedule and development
selection rule fixed. Compare current BF16 optimization with the validated
numerical implementation on the same paired seed 17. Reuse the old BF16 E/U/X
artifacts only when all configuration keys match; otherwise rerun that comparator.
The changed factor is numerical computation, not the seed or a new named method.

Keep free-generation evaluation on the original frozen BF16 evaluator for both
candidate families. Any FP32 decoder evaluation is secondary and explicitly
separate. Apply the same seven-checkpoint selection per parent and 15-candidate
crossover search, counting its extra generations. Report target loss, development
and diagnostic behavior, utility, protected pixels, OCR, PDF rendering and
truncation. Instruction controls from A are absent from the primary image-only
evaluation prompts. Reused six-question results remain diagnostic outcomes;
reserve new prompts before a later confirmatory test.

Shaving requires a behaviorally successful pixel candidate. Additional seeds,
documents, transfer, SAM and Gumbel remain follow-ups requiring an observed effect
or a specific remaining failure to test. They are not automatic extensions of
this protocol.
