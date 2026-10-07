# Evidence validation — 30 September 2026

## Material Passport

- Origin Skill: academic-research-suite / experiment-agent
- Origin Mode: validate
- Origin Date: 2026-09-30
- Verification Status: ANALYZED
- Version Label: meeting-evidence-v1

This is an artifact and interpretation audit, not an independent model rerun.
The meeting brief separates observations, unexecuted plans, and submitted work.

## Checks performed

The two compressed response archives were read directly and recounted. They
contain 1,400 pilot logical rows and 288 delivery-diagnostic rows. Task counts,
recorded strict labels, and truncation counts reproduce the completion report.
This recount does not replace the report's semantic review. See the
[machine-readable recount](response-recount.json).

The completed frozen-decoder report was fetched with byte-count and SHA-256
verification. All 60 nominal/realized comparisons, finite differences, error
values and acceptance decisions were recomputed from the recorded losses.
Upstream report hashes and local implementation hashes match. All three replay
records report bitwise equality; the scheduler records successful completion and
the log records 17 passing CPU tests. The raw remote NPZ tensors were not
downloaded, so projections and replay equality were not independently rebuilt.
See the [decoder audit](../2026-09-27-precision-continuation/decoder-summary.json).

The separately submitted full-path FP64 diagnostic passed 18 relevant local CPU
tests and shell syntax validation. An initial test command from a subdirectory
resolved a Python interpreter without PyTorch; rerunning with the project's
interpreter and module path passed. This was an environment failure, not a model
result. Its PBS script requires 21 tests before model computation. GPU submission
does not count as numerical validation or behavioral success.

## Interpretation checks

| Potential error | Treatment in the meeting brief |
| --- | --- |
| Simpson's paradox | Keep historical fixture, page, document, delivery and precision conditions separate |
| Ecological inference | Limit inference to one document and surrogate; response rows are not independent documents |
| Selection/Berkson bias | Identify development-selected candidates and extra crossover selection compute |
| Collider adjustment | No covariate-adjusted causal estimate is made; not applicable |
| Base-rate neglect | No population protection rate or detector accuracy is inferred |
| Regression to the mean | Historical selected success is not a matched causal baseline for the new document |
| Survivorship bias | Retain truncated responses, failed diagnostics, and unexecuted planned branches |
| Multiple searching | Report checkpoint/crossover search; do not select a favorable condition as general success |
| Forking analysis paths | Describe the continuation as exploratory with versioned diagnostic protocols |
| Correlation versus causation | Do not isolate precision, document, runtime or backend effects from confounded comparisons |
| Reverse causality | No observational directional causal estimate is made; not applicable |

No significance test or binomial interval is reported over repeated conditions
on a single document. A zero strict-success count does not prove zero probability
of protection, and a strict failure can still contain refusal language or leakage.

## Completed FP64 reference update

By 14:05 Sydney, all four final diagnostic shards had exited 0 and each had
passed 24 CPU prerequisites. A subsequent CPU audit on HPC checked artifact
hashes, reconstructed twelve analytic projections from saved gradient and direction
tensors, and recomputed all 96 finite differences and decisions. All twelve
directions satisfy the original adjacent-step criterion; 60/96 individual steps
pass. The fetched reports were reconstructed locally with identical hashes.

This supports the tested smooth FP64 reference, not the original FP32 optimizer,
saved-byte/PDF derivatives, or behavioral protection. The already observed BF16
behavioral outcomes and the unexecuted efficacy comparisons remain unchanged.
See the [combined audit](../2026-09-27-precision-continuation/completed-full-fp64-summary.json).
