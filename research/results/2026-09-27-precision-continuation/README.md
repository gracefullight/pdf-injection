# Perturbation continuation: numerical precision

Current status, September 30: all four FP64 shards completed successfully by
14:05 Sydney. The combined audit verifies all 96 comparisons and reconstructs all
12 analytic projections from saved tensors. All twelve directions pass the fixed
adjacent-step criterion. This validates the tested smooth FP64 reference; the
original FP32 gate remains failed, and the primary behavioral E/U/X comparison
remains unexecuted. See the [completed audit](completed-full-fp64-summary.json).
The frozen-decoder retry completed on September 28 at 19:55 with exit status 0
and 17 passing CPU tests. Both decoder precisions agree at the two smallest
embedding steps, but this does not pass the failed full pixel-input gate.
A new full-path FP64 step-scale diagnostic was submitted on September 30 at 12:53;
see its [fixed protocol](../../hpc/full-fp64-scale-protocol.md). The BF16 behavioral
pilot was completed earlier and must not be confused with this unexecuted FP32
comparison. See the [meeting brief](../2026-09-30-meeting/meeting-brief.md).

Historical default-backend validation failed after 2 minutes 12 seconds of GPU execution.
The job started at 00:37 and ended at 00:39 on September 28 (Australia/Sydney),
with exit status 2. All 12 FP32 and 12 BF16 directional checks failed the fixed
agreement criterion. The dependent optimization job ended without starting;
there are no new optimized candidates or response generations.

The [raw numerical report](failed-numerical-report.json) records actual FP32
parameters with TF32 disabled. For the first FP32 direction, the analytic
projection was approximately 1.08e19 while central differences ranged from
-1.11e4 to 3.26e3. This is an unresolved numerical-path failure, not evidence
that perturbation cannot steer the model. No tolerance was relaxed.

A follow-up diagnostic compares repeated identical forward/backward calls using
default SDPA and forced math SDPA, in both precisions, for the first prompt and
saved clean-interior state. It reuses the failed check's saved direction and
step sizes. This isolates repeatability and backend effects; it does not replace
the full validation gate. The earlier device-selection failure remains separate
from this completed numerical check.

## Fixed comparison

Compare the existing seed-17 BF16 E/U/X candidates with FP32-optimized E/U/X
candidates on Specification3 page 2. Keep the model weights frozen, the 8/255
constraint, protected text mask, 36 updates per parent, development questions,
checkpoint schedule and crossover search. Selection and final generation both
use the original BF16 evaluator. The current continuation changes optimization precision and attention backend
jointly; the paired seed is fixed.

The reference check tests the smooth identity input path on two feasible pixel
states and two training prompts. Three saved FP32 sign-gradient directions and
three fixed step sizes are reused for BF16. Passing this check is not validation
of JPEG/PDF BPDA, saved-byte gradients, or response steering. Text-policy and
system-policy controls are deferred and are not prerequisites for optimization.

If numerical validation passes, the prepared continuation runs 72 optimization
updates and development selection over 14 parent checkpoints and 15 crossover
candidates (232 development generations in total). Eight final inputs comprise
clean, matched random, three historical BF16 candidates and three FP32 candidates.
Six page transformations and two full-document renderer conditions are evaluated
with six task requests at both 192 and 768 tokens, plus four 64-token utility
questions. This produces 1,024 logical response rows; identical input/prompt/limit
triples are cached within this run. Prior final questions are diagnostic repeats,
not a fresh held-out test set.

## Execution records

Personal paths, scheduler job identifiers, GPU UUIDs, notification addresses and
SSH handles are kept in private operational records. Shared results will include
source/code hashes, numeric checks, saved pixel metrics, actual raw responses and
post-run OCR/semantic review. Experiment state belongs here, not in the HPC usage
manual.

See the [protocol](../../hpc/numerical-and-policy-controls.md),
[numerical runner](../../hpc/precision_preflight.py) and
[optimization/evaluation runner](../../hpc/precision_continuation.py).

A detached status monitor samples PBS state, available GPU counts and saved
artifacts every 60 seconds. Start/end/abort notifications are enabled for both
replacement jobs. All 14 [HPC CPU tests](cpu-tests-hpc.txt) passed, covering numerical agreement,
GPU selection, separate optimizer/evaluator routing, failed-reference rejection
and response-cache identity. These are implementation checks, not model results;
continuation tests are also enforced before optimization. Shared
filesystem module-import delays observed during CPU checks are retained in
private diagnostics and are not classified as model failures.

The minute monitor recorded both jobs finished at 00:40 on September 28 and
stopped. It recorded scheduler state and artifacts; it did not repair failures.

The follow-up diagnostic was submitted at 01:18 on September 28 and was queued
at the subsequent check. It requests one GPU for up to 20 minutes. Begin/end/abort
notifications and the 60-second status monitor are enabled.

## Diagnostic failure and retry

The first backend diagnostic ended at 02:02 on September 28 with exit status 1,
after 37 seconds. Default FP32 completed its first row: identical-input losses
were 2.665417, 2.695230 and 2.640300, and repeated input gradients differed
substantially. The source of this instability remains unresolved. Math SDPA then
exhausted GPU memory during the first gradient-enabled forward pass, using
approximately 94.11 GiB of a 94.97 GiB device. This prevents a backend conclusion.
The [partial report](failed-diagnostic-partial-report.json) is preserved as written;
its `running` status is stale and is superseded by this execution record.

The retry uses non-reentrant activation checkpointing on vision and decoder blocks
for math SDPA, preserving evaluation mode, frozen weights, full input resolution
and the saved direction. A CPU regression test checks equality of outputs and input
gradients against an unwrapped frozen toy network, including evaluation-mode
Dropout. That test runs as a prerequisite in the GPU job; it has not yet reported
on the retry. Incremental diagnostic writes now preserve each repeat before the
next operation. The retry was submitted and is queued; minute monitoring and
begin/end/abort notifications are enabled. No optimization run has started.

## Completed diagnostic retry

The retry finished successfully at 06:10 on September 28 (exit status 0,
1 minute 19 seconds). The checkpoint CPU regression passed. All four
precision/backend combinations completed; see the
[raw report](completed-diagnostic-report.json) and
[interpretation](diagnostic-summary.json).

FP32 math SDPA with recomputation used 23.61 GiB peak PyTorch-allocated memory.
Its three identical-input losses were exactly 2.560552597 in the recorded output,
and both gradient summaries matched. The default FP32 losses varied from
2.609271 to 2.695498. The change removes the observed repeatability problem in
this diagnostic, but does not establish a specific kernel defect.

The three FP32 math directional errors were 55.70%, 15.42% and 10.48%, all above
the fixed 5% criterion. BF16 finite differences remained zero at these small
steps. The diagnostic therefore completed without validating the reference.
Optimization remains unstarted. A follow-up must resolve the residual numerical
mismatch before rerunning the full gate; the tolerance has not been relaxed.
The minute monitor recorded completion at 06:10:20 and stopped.

## Math-sign continuation

The next run repeats all 12 FP32 directional checks with fresh gradients from
math SDPA, rather than the saved directions from unstable default FP32. The
original three step sizes and acceptance tolerance are unchanged. BF16 reuses
these new directions. Forward and checkpoint recomputation both force math
SDPA for the optimizer, including backward calls outside the loss context.
A source-hash guard ties the subsequent optimizer to the validated path.

The prepared dependent job runs the existing 72-update E/U optimization,
15-candidate X search and 1,024-row BF16 generation evaluation after the full
gate succeeds. This comparison changes precision and backend together; it cannot
identify a precision-only effect. No successful perturbation is claimed by
submission or by a numerical pass. Current scheduler states are in execution.json.

## Failed full math-sign gate and step-scale follow-up

The full math-sign gate ran for 3 minutes 3 seconds and exited 2. None of the 12
FP32 directions had two adjacent passing steps; see the
[raw report](failed-math-sign-report.json) and [summary](math-sign-summary.json).
The first direction's analytic derivative was 17,817.71, versus central differences
6,332.52, 4,018.37 and 3,079.03 as the step increased. This trend motivates testing
a smaller local interval without assuming that either the gradient or the step
selection is correct.

The follow-up uses seven exact binary steps from one to 64 FP32 ULPs, verifies
actual displacements, and retains the original tolerance and all 12 required
reference directions. It is a new diagnostic protocol, not a relaxed threshold.
Its submitted dependent optimization runs only after a complete numerical pass.

## Failed representable-step gate and path localization

The ULP run completed all 24 directional rows and 168 central differences in
5 minutes 44 seconds. All 12 FP32 and 12 BF16 rows failed the unchanged adjacent-step
criterion. The [raw report](failed-ulp-report.json), [log](failed-ulp-log.txt),
[source hashes](ulp-code.sha256) and [audit](ulp-summary.json) are preserved.
All six recorded source hashes match the local files. Recomputing every central
difference and acceptance decision from the recorded losses reproduced the report.
The first FP32 direction has analytic projection 17,817.71 versus 13,704.00 at
one ULP (23.09% relative error). BF16 differences are zero at every tested step.
There are no saved-byte proposals, new optimized candidates or generation rows.

Exact input displacements rule out rounded input steps in this run, but do not
rule out rounding inside normalization/model operations, strong local curvature,
or a difference between gradient-enabled and no-grad forward execution. None is
yet an established root cause. The next diagnostic fixes the first training
prompt, saved clean-interior state, three saved directions and seven ULP steps.
It compares both forward modes, repeats base forwards, and projects central
differences at patch embedding and vision output onto their base-loss cotangents.
It also checks the affine pixel-packing tangent against realized differences.
These observations localize a discrepancy; they do not replace full numerical
validation or authorize the main optimizer. The bounded run makes one base
backward, four repeated base forwards and 84 perturbed full-model forwards.

Eleven relevant local CPU tests passed, including capture of outer-boundary
cotangents with checkpoint recomputation. The broader local continuation test
could not import `reportlab`; the PBS job requires all 14 tests, including continuation checks, before model computation.
No optimizer implementation fix is claimed before this diagnostic supplies evidence.

The initial login-node pre-submission test process timed out after 300 seconds
before any test output. A bounded trace localized time spent in shared-filesystem
module reads through `importlib.get_data`, including SymPy. The previous compute-node
log recorded all 12 prerequisite tests passing in 0.128 seconds. The new submission
therefore retains and expands the mandatory tests inside PBS, before model loading,
while omitting the duplicate login-node suite. No GPU job was submitted by the
timed-out attempt. The single subsequent diagnostic is queued; one minute monitor
and begin/end/abort notifications are active.


## Completed path-localization audit and disposition

The [raw report](completed-path-report.json), [job log](completed-path-log.txt),
[seven source hashes](path-code.sha256) and [audit](path-summary.json) are archived.
The run took 3 minutes 3 seconds; all 14 prerequisite CPU tests passed.
The complete grid contains three directions, seven unchanged ULP steps, and two
grad modes: 42 comparisons from 84 perturbed forwards, plus four base forwards.
Every loss finite difference, acceptance decision and boundary error calculation
was recomputed. All seven source hashes and the failed-gate provenance match.
The 21 paired grad-enabled/no-grad records match exactly. Base losses and captured
base boundary outputs match across both modes and repeats. Analytic projections
and loss checks reproduce the prior clean-state, first-prompt ULP results.

No loss comparison passes. At one ULP, relative loss errors are 23.09%, 12.77%
and 16.12% for all, even and odd tiles. The corresponding vision-output cotangent
projection errors are 2.26%, 4.88% and 4.01%. Affine packing has relative tangent
errors of 0.23%–14.48% across tested steps. At larger steps, patch-embedding
projections become more accurate while vision and downstream loss agreement
worsen. The observations rule out an observed grad-mode mismatch in this grid;
they do not establish a particular autograd defect or distinguish internal
roundoff from local curvature. Boundary projections reuse base-loss cotangents
and are not an independent derivative reference. Raw boundary arrays were not
saved, so their projections cannot be independently reconstructed from this
archive; the audit checks their reported error arithmetic.

No evidence establishes a specific optimizer correction that would justify a
new full-gate submission. The bounded attempt closes with the reference failed.
Repeating the same gate, shrinking steps again, changing the objective, or
lowering tolerance would not resolve the demonstrated validity gap. Any future
continuation needs a separately specified numerical hypothesis and must still
pass the full 12-direction gate before primary optimization. No inference about
perturbation efficacy or a precision-only causal effect follows from these runs.

The final scheduler audit confirms no active experiment jobs, no new optimizer
checkpoints, and no new response files. The path run produced only its report;
there are no new image/PDF candidates requiring OCR or semantic response review.
This does not substitute for the planned evaluation. The minute monitor was no
longer running at audit time; its last sample preceded job completion, so direct
scheduler history and the retrieved outputs establish completion.

Scheduled follow-up was disabled after the completed result review.

## Resumed primary objective and frozen-decoder intervention

The earlier closure and automation shutdown concerned a completed diagnostic,
not completion of the requested E/U/X comparison. That stopping decision was
premature and is superseded here. Prior reports and audits remain immutable.

The new [protocol](../../hpc/numerical-and-policy-controls.md) freezes captured
vision embeddings, requires exact decoder replay, compares decoder precision
separately from cross-entropy precision, and records actual boundary displacements.
Its FP64 arm explicitly removes the decoder RMSNorm downcast and fixes the same
original positional constants. It is a diagnostic reference, not a declared
optimizer correction. Raw boundary arrays will be saved this time. Thirteen
relevant local CPU tests passed; all sixteen CPU tests are required inside PBS
before model computation. No full gate or primary job is submitted before an
evidence-supported correction is identified. Scheduled continuation stays active.

The frozen-decoder diagnostic was submitted once at 15:38 on September 28. At
15:39 it is queued for GPU resources, with no model results yet. A minute monitor
is active. The primary comparison remains incomplete; after interpreting the
diagnostic, test a supported correction and require the full unchanged gate
before running the dependent E/U/X comparison.

### Access interruption on September 28

The 2026-09-28T16:10:13.939191+10:00 continuation could not inspect new results because the SSH session had disconnected and automatic authentication was rejected. The last verified decoder-diagnostic state was queued for GPU resources at 15:41:49 Sydney; its current state and monitor health are unknown. No additional job was submitted. Direct authentication in the existing terminal is required before auditing outputs or testing a correction. The primary comparison and result review remain incomplete, and automatic follow-up remains enabled.

## Decoder diagnostic implementation repair

The first frozen-decoder diagnostic exited 1 after 44 seconds at 16:08 on
September 28. All 16 CPU prerequisites passed, and the three replay checks
reproduced captured logits bit for bit. Before the reduction comparisons, the
second backward attempted to re-enter a single-use checkpoint recomputation
context, raising `AttributeError` in `contextlib`. The
[partial report](failed-decoder-report.json) and [sanitized log](failed-decoder-log.txt)
are preserved. This is an implementation failure, not a numerical rejection.

The repair runs separate forward/backward graphs for FP32 and FP64 loss
reductions. A regression checks both gradients against an unwrapped frozen model
while exercising the same checkpoint/math-context mechanism. Fourteen relevant
local CPU tests passed; the resubmitted PBS diagnostic requires 17 tests before
model computation. No loss definition, numerical tolerance, model weight or
primary evaluation condition changed. The retry was submitted at 16:58 through
the existing SSH terminal. The remote minute monitor was restarted for that job;
Orca agent automation remains disabled at the user's request. The primary E/U/X
comparison remains unexecuted.

## Completed frozen-decoder diagnosis

The retry finished at 19:55:32 on September 28 (Australia/Sydney), with exit status
0 and 3 minutes 56 seconds walltime. The [raw report](completed-decoder-report.json),
[log](completed-decoder-log.txt), and [scalar audit](decoder-summary.json) are archived.
All 17 CPU prerequisites passed. Three decoder replays reproduced captured logits
bit for bit. All 60 recorded scalar comparisons and acceptance decisions were
recomputed locally; diagnostic and upstream provenance hashes match. Remote NPZ
arrays are listed with hashes in the report but were not downloaded for an
independent reconstruction of tensor projections.

| Embedding-secant scale | FP32 relative error | FP64 relative error |
| --- | ---: | ---: |
| 0.125 | 0.0065% | 0.7299% |
| 0.25 | 2.4036% | 2.8853% |
| 0.5 | 10.2159% | 10.1853% |
| 1 | 15.4451% | 15.6780% |
| 2 | 12.3418% | 12.2248% |

These values use realized displacements and FP64 loss reduction. FP32 reduction
has the same pass/fail pattern. Both decoder arms pass at the two smallest
adjacent scales. All ten loss-only rows pass; their maximum realized relative
errors are 0.1044% in FP32 and 0.000130% in FP64. Changing only the loss reduction
does not explain the larger decoder discrepancy in this direction.

FP64 covers the decoder, head, and RMS arithmetic while retaining captured FP32
vision embeddings and original position constants. It is not full-model FP64.
The scale dependence supports a local nonlinearity/step-size contribution, but
does not establish a unique cause or validate the original end-to-end gradient.
No optimized candidates or behavioral responses were generated by this diagnostic.

## Submitted full-path FP64 follow-up

The September 30 follow-up reuses the original twelve directions, two states and
two prompts. It tests eight exact steps from 2^-30 to 2^-23 with FP64 pixel-to-loss
arithmetic, fixed original constants, math attention and checkpointing. The
original tolerance remains unchanged. Eighteen relevant local CPU tests passed;
21 tests are required in PBS before model loading. It requests one GPU for up to
30 minutes. Notifications and a 60-second scheduler logger are enabled; Orca
agent automation stays disabled. Submission is not a result. A diagnostic pass
will not automatically start the old FP32 optimizer.

## Full-path timeout and resumed execution

The first full-path run started at 13:01:45 on September 30 and ended at 13:31:53
with scheduler exit status -29: walltime 30 minutes 6 seconds exceeded the
30-minute limit. All 21 CPU prerequisites passed. This was a resource-limit
termination, not a numerical rejection. The [partial report](partial-full-fp64-report.json),
[log](partial-full-fp64-log.txt), and [audit](partial-full-fp64-summary.json) are retained.

Seven of 96 central-difference pairs were saved, together with the first group's
FP64 gradient. For the clean-state, first-prompt, all-background direction, errors
at the four smallest steps were 0.0204%, 0.0816%, 0.3261%, and 1.3011%, all passing.
The next three errors were 5.0771%, 17.5208%, and 27.6598%, all failing. Every
recorded scalar comparison was recomputed locally. The partial first direction
already exhibits adjacent-step agreement, but no complete eight-step direction
or twelve-direction reference was finished.

The same grid is now split into four state/prompt shards, with three directions
per shard and a three-hour walltime each. The first shard validates and reuses
the saved gradient and seven completed pairs. The original reference code and
all numerical thresholds remain unchanged. Twenty-one local CPU tests passed;
24 are enforced in PBS. Notifications and the minute scheduler logger cover all
four replacement jobs. Their combined audit is required before any full-reference
claim; no behavioral optimization has started.

Two initial shards stopped before model computation because GPU device discovery
failed on their allocated node. A replacement on another node was also rejected
by the unchanged idle-device guard: one GPU reported 100% utilization with no
recorded memory/process, while the other was occupied. These infrastructure
failures produced no numerical observations and are separate from the walltime
termination. Only failed shards were resubmitted to other nodes; active shards
and the device-ownership checks were preserved.

## Completed full-path FP64 reference

All four final shards exited 0, with 24 CPU prerequisites passing in each. The
last completed at 14:05:01 Sydney. The four walltimes were 12:24, 18:56, 21:38 and
19:01. The original seven pairs were reused once; together the shards contain the
complete grid of two states, two prompts, three directions and eight step sizes.

The [combined audit](completed-full-fp64-summary.json) verifies input, source,
report and gradient archive hashes, rechecks all 96 finite-difference calculations
and decisions, and independently reconstructs twelve analytic projections from
archived gradients and the original saved directions on the HPC CPU. Recorded
parameter and selected intermediate dtypes are FP64. Each group's base loss
reproduces exactly across the required repeated forwards. This is artifact
verification, not a fresh model rerun.

| Result | Observation |
| --- | --- |
| Direction criterion | 12/12 have at least two adjacent passing steps |
| Individual comparisons | 60/96 pass; all steps were retained |
| Worst error at smallest step, 2^-30 | 0.2386% |
| Worst error at next step, 2^-29 | 0.8817% |
| Directions passing at the old one-ULP step, 2^-24 | 0/12 |
| Clean-state FP32 versus FP64 analytic projection difference | 0.0010%–0.0094% |
| Crossover-state FP32 versus FP64 analytic projection difference | 12.63%–29.81% |

The small-step agreement supports the local FP64 derivative reference. The
large-step failures persist even in FP64, consistent with a step-scale effect.
However, the state-dependent precision differences preclude claiming that step
size alone explains the original FP32 failures. A unique root cause is not proven.
No saved-byte/PDF BPDA derivative or behavioral protection is validated here.

Raw reports and logs: [clean, prompt 0](completed-full-fp64-clean-p0.json),
[clean, prompt 1](completed-full-fp64-clean-p1.json),
[crossover, prompt 0](completed-full-fp64-crossover-p0.json), and
[crossover, prompt 1](completed-full-fp64-crossover-p1.json); matching `.log` files
are archived beside them. No optimizer or response-generation job was launched
by these diagnostic shards. The next efficacy experiment needs to use the
validated FP64 path and the unchanged BF16 evaluator, with real saved-byte checks.

## Behavioral follow-up submitted

The validated FP64 path is now used by the separate
[behavioral continuation](../2026-09-30-fp64-behavior/README.md). Two E/U parent
optimization jobs are running, with BF16 selection and final evaluation submitted
as a success-dependent job. This is a new efficacy experiment; it does not change
the failed status of the original FP32 comparison or establish behavioral success.
