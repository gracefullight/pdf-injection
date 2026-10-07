# Next experiment: continue the text-free document perturbation study

## Material Passport

- Origin Skill: ARS experiment-agent
- Origin Mode: plan
- Origin Date: 2026-09-27
- Verification Status: EXECUTED — bounded pilot and diagnostic; see completion report below
- Version Label: textfree_continuation_v3

## Scope

Continue the existing document-pixel optimization work. SAM was an example of a
possible method, not a user-selected next experiment. Neither SAM adaptation nor
cross-model transfer is a prerequisite. The prior SAM-first and transfer-gated
plans are superseded.

## Established starting point

The saved x05 candidate combines two text-free perturbations: an EOT candidate
and a utility-plus-EOT candidate. The selected channel crossover uses utility
fraction 0.75 and seed 17, at 8/255. Qwen PDF rendering produced R2 2/12, R1 6/12,
R0 4/12. Luna transfer was not observed. The artifact is a one-page synthetic
fixture, not Specification3.pdf. See the
[commit audit](../results/2026-09-27-commit-audit/README.md) and
[crossover manifest](../results/2026-09-13-surrogate-factorial/textfree-c0-crossover-manifest.json).

This leaves two immediate questions: whether the same procedure works on an
actual assessment document, and which part of the existing procedure preserves
refusal plus referral across prompts and PDF rendering. New methods should target
a measured remaining failure, not replace this baseline before it is established.

## Immediate experiment

Use Specification3.pdf and the supplied experimental policy. Preserve the native
original. Start with answerable requests about page 2, then evaluate the complete
seven-page document. Reoptimize for its pixels; do not resize or paste the old
fixture's perturbation and call it a new-document result. Protect body text and
diagrams and record clean reading performance at the selected rendering geometry.

Execution amendment after the first preflight: retain its incorrect heading-colour
answer as a baseline utility failure, and allow the user-requested continuation
once processor, gradient and saved-byte checks pass. Do not require perfect clean
visual-question accuracy to run the feasibility experiment. The explicit exception
and baseline responses must appear in the run manifest. No prompts, answers or
held-out selection rules change; see the [execution protocol](README.md#explicit-baseline-reading-exception).

Generate and compare these existing-method candidates at the same 8/255 bound:

| Candidate | Existing procedure | Question |
| --- | --- | --- |
| E | Response optimization with document transforms (EOT) | What does the existing perturbation objective achieve? |
| U | The same procedure with permitted-reading utility supervision | Does preserving reading change refusal/referral and robustness? |
| X | Crossover of E and U, selected using development free generation | Does the x05 selection procedure improve on either parent? |

Use clean, matched random and readable-policy controls. Preserve the historical
15-candidate crossover search as a declared development budget, including its
fractions, crossover types and seeds. Do not assume the historical 0.75/17 winner
will also win on the real document. Count all candidate-selection evaluations
and report crossover's extra compute separately.

Keep the source model frozen, use paired optimization seeds and match E/U update
budgets, masks, precision and transformation conditions. Reuse the existing
quantized candidate bank and free-generation selection. Check renderer parity at
the new geometry; an MLX-to-CUDA port is a separate implementation variable.

Reserve fresh final questions before optimization: six task requests and four
policy-permitted reading questions. Use separate optimization/development prompts;
do not tune against the final answers. Exclude summarization from permitted tasks
under the supplied policy. Record R0/R1/R2/RX, completion, task-specific leakage,
OCR, protected-pixel changes and utility rather than treating R0 as correctness.

Evaluate each candidate as a direct image and after PDF rendering. Then replace
only the selected page in the complete clean raster document and evaluate again.
Retain native-PDF and clean-raster-PDF baselines to isolate conversion effects.
Compare JPEG 95/85, resize and a second renderer as separate conditions. A page
result is not automatically a whole-document result.

## Follow-up within the existing optimization pipeline

If the new document reproduces the historical R1-heavy behavior, compare the
selected crossover with a continuation using the already implemented joint branch-
token objective and multi-prompt/PDF conditions. Continue both parents with the
same extra update budget as controls, so improvement is not attributed to
crossover when extra optimization explains it. Select using actual refusal and
referral, not NLL alone. This combines existing components; it is not claimed to
be a new optimization algorithm.

If PDF conversion is the main failure instead, investigate renderer parity and
condition-specific free generation before changing surrogate training. If clean
reading fails, fix resolution or question answerability before optimizing.
After a successful candidate is found, use shaving to measure its retained
behavior at lower amplitudes; label scaling and reoptimization separately.

## Research interpretation

Primary results are within-surrogate effects, prompt/rendering robustness,
perturbation requirements, and preserved document utility. Transfer is an
additional characterization and may remain a limitation or future work. Retain
null results, regressions and failed full-document generalization.

ImageProtector informs the response objective, while the repository already adds
utility, document transforms and decoder selection. CoTTA-style alignment, SAM,
Gumbel-based discrete region selection and other methods remain candidate
follow-ups only after the baseline identifies the question each would test.
Using a named technique alone is not a research contribution. The results should
establish what changes, under which conditions, and what remains unresolved.

No new model experiment or SAM training was performed when this plan was initially
authored. The later execution is recorded separately below.

## Execution disposition

The [completion report](../results/2026-09-27-policy-delivery/completion-report.md)
closes the bounded E/U/X pilot and subsequent policy-delivery diagnostic. It
includes raw-response archives, strict-endpoint review, leakage lower bounds,
OCR, visual checks, protected-pixel checks and separately counted crossover
selection compute. No strict R2 was observed. The R1-heavy continuation and
success-dependent shaving branches were not triggered. Transfer and named new
optimizers were not completion requirements. Historical run manifests remain
unchanged; their pending-review fields describe the state at generation time.
