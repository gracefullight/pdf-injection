# Policy-delivery diagnostic

Status: all 288 generations completed with PBS exit status 0 in 00:35:39.
All 48 cells contain six questions, with no duplicate or missing response keys.
All 144 short responses are prefixes of their paired long responses.
Strict-endpoint review is complete; see the [completion report](completion-report.md)
for the combined pilot and diagnostic findings, verification and limitations.
See [execution checks](execution.json), [input/model manifest](manifest.json),
[paired analysis](analysis.json), and [raw responses](responses.jsonl.gz).

## Findings

| Intervention | Provisional strict refusal/referral (R2) |
| --- | ---: |
| Policy as user text | 0/48 |
| Policy above the target page in the same image | 0/48 |
| Policy on a separate leading image | 0/48 |
| Clean, blank-area and blank-page controls | 0/144 |

Each policy total includes two document scopes, two selector wordings, two token
limits and six paired questions. These are repeated diagnostic conditions on one
document, not independent samples. No provisional R1 was found either.

| Scope / selector | Truncated at 192 tokens | Truncated at 768 tokens |
| --- | ---: | ---: |
| Single / original exclusive selector | 27/36 | 8/36 |
| Single / non-exclusive selector | 24/36 | 6/36 |
| Full / original exclusive selector | 27/36 | 9/36 |
| Full / non-exclusive selector | 25/36 | 9/36 |
| Total | 103/144 | 32/144 |

Increasing the output budget resolved 71 of the short-run truncations. The 153
complete responses were provisionally R0; the other 135 responses were RX due to
truncation. R0 does not establish solution correctness. The absence of R2 persists
after increasing the token limit and removing "only" from the page selector.

The [targeted manual review](targeted-manual-review.json) covers all 24 T1 responses
at 768 tokens. Every scope, selector and delivery/control combination gave the
same complete task-specific round-start condition, with no refusal or referral.
This is substantive answer leakage under the declared rubric, not a truncation
artifact. A broader lexical scan found no instructor/referral or policy-refusal
cues in the 288 responses; that scan is not exhaustive semantic adjudication.
The subsequent [semantic review](semantic-review.json) records focused review of
all 118 distinct long-response/question groups, with a conservative lower bound
of 163 rubric-positive rows. It also reviews in full all five distinct complete
outputs within the 96-token strict-endpoint limit (58 rows); none contains policy
refusal or instructor referral. Four text-policy/exclusive-selector T2 rows say
that the document supplies no code. These are non-answers, not policy refusals.
Full solution-correctness grading and independent human adjudication were not
performed; unconfirmed leakage is not scored as absence of leakage.

Within this diagnostic, truncation was a measurement problem, but increasing
the limit did not produce the target behavior. Policy placement and exclusive
page-selection wording also did not rescue refusal/referral. Since verbatim user
text failed too, image rendering alone cannot explain the missing target behavior.
This does not identify the model's internal cause or establish that it cannot
follow stronger instructions, a system-role policy, or a different prompt.

## Design and validation

The [fixed design](../../hpc/policy-delivery-diagnostic.md) compares policy delivery
as text, within the target-page image, and on a separate leading image. Clean,
blank-area and blank-page controls distinguish policy content from geometry.
The paired factors are the original versus non-exclusive page selector, single
versus full document, and 192 versus 768 new tokens. Six reused diagnostic
questions produce 288 response rows. There is no optimization or seed sweep.

Four CPU tests passed locally and on HPC: target-pixel preservation, matched page
ordering, text-only prompt intervention, and the complete paired condition matrix.
The composed notice/target image was visually inspected before GPU submission.
Model preprocessing must preserve source geometry; image-grid checks are saved
with input hashes in the run manifest.

Raw generations and completion flags, rather than successful process execution,
determine the observations. Legacy R0/R1/RX labels remain provisional; zero strict R2 is supported by the
completion/length checks and complete review of the remaining eligible outputs.
The compressed raw-response file was retrieved and its decompressed SHA-256
verified against the remote analysis. Prior final questions are reused for
diagnosis and are not a fresh test set. No intervention changes the model's weights
or the source document pixels. Execution state is recorded here, not in the HPC
usage manual.
