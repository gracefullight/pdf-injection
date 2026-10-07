# FP64 behavioral continuation

This experiment continues the completed Specification3 BF16 E/U/X pilot using
the audited FP64 optimization path. The behavioral endpoint remains the original
BF16 Qwen evaluator, in a fresh process without FP64 model overrides.

The [fixed protocol](../../hpc/fp64_behavior_protocol.md) specifies 36 updates
per parent, the original protected-text mask and 8/255 bound, seven checkpoints
per parent, and the historical 15-candidate crossover search. Selection uses
232 logical development generations. The final comparison has 1,024 logical
rows across clean/random controls, historical BF16 E/U/X and new FP64 E/U/X.
These are planned budgets, not completed observations. Questions are reused
for diagnosis, so this is not fresh held-out evidence.

Ten CPU regression tests passed locally. They cover reference rejection,
checkpoint tampering, saved-byte constraints, stable proposal selection,
generation cache identity and checkpointed gradient behavior. The same ten
are required inside each PBS job before model computation. The login-node
attempt was interrupted during a slow PyTorch import and is not counted as a
completed test run. GPU jobs use the existing HPC virtual environment.

Two three-hour parent jobs precede a six-hour BF16 selection/evaluation job
through a success-only dependency. Every optimizer update is saved; evaluation
caches each generation. Minute scheduler logging records state and artifact
progress without submitting or repairing jobs. Begin/end/abort mail is enabled.

At 14:29 Sydney, both parent jobs were running and the evaluation job was held
for their successful completion. Two minute-logger samples confirm the dependency state. Both parent manifests
were created after their CPU prerequisites, but no completed update was observed
at the 14:30 check.
No new behavioral conclusion is available at submission. A numerical reference
pass alone does not show refusal/referral success. Final automatic labels still
require response/leakage review and OCR/artifact checks.

## Parent completion, September 30

Both parent jobs exited 0 after about 72 minutes, completing all 72 updates
and seven saved checkpoints per arm. E accepted 23 nonzero proposals and retained
its current image 13 times; U accepted 32 and retained it four times. All recorded
updates respected the 8/255 budget and protected-text mask. These are optimization
observations, not response-generation success. The
[parent audit](parent-completion-summary.json) rechecks manifest histories;
independent pixel and OCR review is still pending.

The dependent BF16 evaluator was queued at 15:54 because its originally selected
node had no free GPU. The existing queued job was moved to a node with an
unassigned GPU and sufficient memory; no duplicate evaluation was submitted.

At 15:55:39 Sydney, the scheduler confirmed that the BF16 evaluation job was
running. No completed selection or final-generation result was observed yet.
