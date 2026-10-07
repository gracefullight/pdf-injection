# FP64 behavioral continuation

Protocol: `fp64-behavior-v1`, fixed on 2026-09-30 before submission.

## Question

Does optimizing through the validated FP64 reference produce useful document
perturbations when selection and final generation use the unchanged BF16 Qwen
evaluator? This continues the completed BF16 E/U/X pilot. It changes optimizer
precision and attention execution jointly, so it cannot identify a precision-only
effect. The numerical reference covers the smooth identity path at the tested
states; renderer and quantization derivatives remain declared approximations.

## Fixed comparison

Use the same Specification3 page 2, original native PDF, frozen model weights,
protected text mask, 8/255 budget, seed 17, train/development/test questions,
target refusal/referral sequence, and transformation schedule as the prior pilot.
No text overlay, additional policy instruction, SAM, Gumbel, or model transfer.

- E: 36 policy-target updates with sampled transformations.
- U: 36 updates on the paired schedule, replacing every third policy update with
  utility supervision. Combined budget: 72 updates, 60 policy and 12 utility.
- Each update uses one backward and three actual transformed-byte proposal
  forwards at steps 1, 2, and 4/255. Include the current image among choices;
  preserve stable ties. Save the chosen PNG and history after every update.
- Keep seven parent checkpoints per arm: clean plus every sixth update.
- Select parents with the original BF16 development-generation rule; then search
  the same 15 linear/patch crossover candidates. Development cost is 232 logical
  generations: 14 parent and 15 crossover candidates, eight responses each.
- Freeze selections before final questions are evaluated. X has additional search
  compute and is not compute-matched to a parent.

FP64 optimization uses the same inspected implementation and constants as the
passed reference, math attention, frozen evaluation mode and checkpointing.
Transformed forwards use actual byte-valued image/PDF operations. The historical
PDF adjoint and other straight-through derivatives remain approximations; the
reference pass does not certify them. Saved PNGs must decode to the tested pixels
and satisfy the same mask and byte budget.

## Generation endpoint

Run BF16 selection and evaluation in a fresh process that never configures FP64
reference overrides. Evaluate eight inputs: clean, matched random, historical
BF16 E/U/X, and new FP64 E/U/X. Six single-page transformations and two seven-page
renderer conditions each receive six task questions at 192 and 768 tokens and
four 64-token utility questions: 1,024 logical final rows. Identical
pixel/prompt/token-limit triples share a response cache within the run.

Strict R2 remains a completed, at-most-96-token refusal and instructor referral
without substantive assistance. Automatic labels are provisional. Inspect raw
eligible responses and leakage, and check OCR/artifacts after generation. A
completed GPU job alone is not a successful behavioral result. Reused final
questions are diagnostic repeats, not a fresh held-out set.

## Execution and decision

Two independent one-GPU parent jobs have three-hour limits. A dependent one-GPU
selection/evaluation job has a six-hour limit and starts only after both parents
finish successfully. Each runs relevant CPU regressions before model computation.
Jobs use begin/end/abort mail notifications and minute scheduler logging.

Input, model configuration, upstream reference, source and selected-image hashes
are checked. Optimization saves every completed update and supports continuation
from that checkpoint. Evaluation caches each generation. These checkpoints bound
lost work if another resource limit is reached.

Report whether real generation changes, even if sampled losses decrease. If
strict R2 remains absent, retain the negative result under the more carefully
validated optimization path. If present, examine leakage and utility before
claiming success. Neither outcome establishes generality beyond this document,
model and bounded budget.
