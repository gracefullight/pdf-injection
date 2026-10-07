# Full-path precision and step-scale diagnostic

Protocol: `full-fp64-scale-v1`, fixed before submission on 2026-09-30.

The completed frozen-decoder diagnostic agrees at scales 0.125 and 0.25 in both
FP32 and FP64, while larger scales disagree in both. The next question is whether
the pixel-to-loss path has a similarly narrow local agreement region that the
smallest representable FP32 pixel displacement could not resolve.

## Fixed design

- Reuse Specification3 page 2, the two archived interior states, two training
  prompts, protected mask, target sequence, and all twelve archived FP32 sign
  directions from the failed ULP run. No new direction selection.
- Promote the same frozen weights. Use FP64 for pixel normalization, vision,
  decoder, head, and cross-entropy. Remove input-dependent FP32 narrowing in
  RMSNorm and vision rotary multiplication. Retain original FP32 normalization
  and positional constants, promoted exactly where needed. The inspected model
  implementation is pinned by SHA-256.
- Use math SDPA and activation checkpointing, with the math backend also forced
  during recomputation. Check actual parameter and selected boundary dtypes.
- Test eight exact binary pixel steps, 2^-30 through 2^-23. This includes the
  previous one-ULP and two-ULP steps and adds six smaller steps. Reject rounded
  displacements or constraint violations.
- Keep the comparison rule: relative error <= 5% or absolute error < 1e-4;
  require two adjacent passing steps for each of all twelve directions.
- Require identical base losses across one gradient-enabled and two no-grad
  forwards for each state/prompt. Archive FP64 gradients, states, and reused
  directions to support later reconstruction of directional projections.

Budget: one GPU, at most 30 minutes; four backwards, eight repeated base forwards,
and 192 perturbed forwards. CPU regressions must pass inside PBS before model
loading. Incremental results preserve partial progress if execution fails.

## Interpretation and continuation

A pass supports a local derivative reference for this FP64 smooth input path.
It does not retroactively pass the FP32 gate, validate PDF/JPEG surrogate
derivatives, or demonstrate behavioral protection. Agreement appearing only at
smaller steps would support a step-scale limitation; a shared large-step error
would not establish an autograd defect. A failure would retain the numerical
validity limitation and localize what remains unresolved.

If all directions pass, the next justified intervention is a separately specified
FP64 optimizer continuation with the original BF16 generation evaluator and real
saved-byte proposal checks. This diagnostic does not automatically launch the
old FP32 optimizer. If it fails, retain the completed BF16 negative result and
report the unresolved numerical reference in the meeting. No SAM, seed-only sweep,
transfer run, or behavioral threshold change is included here.

## Execution amendment after the walltime termination

On September 30 the first run exceeded its 30-minute limit after saving seven
of 96 planned central-difference pairs. Its first direction agrees at four small
adjacent steps; this partial evidence does not complete the full reference.

The numerical design stays fixed. Execution is split into the four existing
state/prompt combinations, each with three directions and eight steps. Four
one-GPU jobs were submitted at 13:38 Sydney with three-hour limits, below the
queue's six-hour maximum. These are shards of one experiment, not new replications.
The initial walltime estimate was insufficient for full-model FP64 on this GPU.

The first shard verifies and reuses the saved gradient and seven comparisons;
the other shards compute their missing groups. Resume checks cover source and
input hashes, state/direction arrays, gradient archive size/hash, comparison
arithmetic, and exact reproduction of the saved base loss. Every remaining pair
is saved incrementally and timed. The original arithmetic implementation is
unchanged and source-pinned. Twenty-one relevant local CPU tests passed; 24 are
required in each PBS shard before model loading.

All four shard reports must be combined and audited before declaring the full
twelve-direction reference passed. A shard pass alone never authorizes the
optimizer. Original partial outputs remain immutable.
