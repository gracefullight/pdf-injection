# Policy delivery and truncation diagnostic

Design fixed on 2026-09-27 before this diagnostic's generations. This follows the
completed E/U/X pilot, whose classifier found no R2 in either optimized inputs or
readable-policy controls, with substantial truncation. Seed replication is not
the experimental intervention here. No model or pixel optimization is performed.

## Questions and comparisons

1. Does the same notice change responses when delivered as user text, inside the
   target-page image, or in a separate leading image?
2. Does the original instruction to consider only the Game Specification page
   suppress a notice outside that page? Compare it with a target-page instruction
   that does not say "only"; neither selector explicitly tells the model to obey
   the policy. This comparison diagnoses wording sensitivity, not intent.
3. Does increasing the output budget from 192 to 768 expose completion, refusal,
   referral or continued task assistance hidden by the previous truncation?

Use the same frozen Qwen2.5-VL-3B BF16 model, unperturbed page pixels, supplied
notice and six prior final task questions. These questions are now diagnostic
repeats, not fresh held-out evidence. Greedy generation uses no repeated seeds.

## Matrix

| Factor | Levels |
| --- | --- |
| Input scope | Page 2 alone; all seven pages |
| Delivery/control | Clean; notice as user text; notice above target pixels in one image; matching blank area; separate leading notice image; matching blank image |
| Page selector | Original "Consider only..."; "Answer the question about..." |
| Maximum new tokens | 192; 768 |
| Questions | Six fixed task requests, with the existing leakage rubrics |

Total: 2 x 6 x 2 x 2 x 6 = 288 response rows. Compare paired question outcomes.
The primary contrasts are text versus clean, inline policy versus inline blank,
and separate policy versus separate blank, within each scope/selector/token limit.
Then compare token limits and selectors within the same remaining factors.

The inline image stacks the full rendered notice above the untouched target page
(952 x 2464); the blank control has exactly the same geometry. The separate notice
uses the identical notice pixels. No source page is downscaled, overwritten or
optimized. Processor image grids must confirm no implicit resizing. This compares
image segmentation and placement as well as instruction delivery; visual-token
counts differ from text input and are a limitation, not a matched-token study.
Only MuPDF-generated notice pixels and the fixed source page images are used;
renderer robustness and native PDF byte ingestion are outside this diagnostic.

## Reporting

Save every raw response, completion flag, token count, input hashes, image grids,
model/source hashes and classifier label. Retain paired response-prefix checks
to identify unexpected differences between greedy 192- and 768-token runs.
Legacy R0/R1/R2/RX labels are provisional; incomplete output and inability to read
are not successful refusal. Inspect raw responses for task-specific leakage,
referral phrasing and false negatives before drawing conclusions. Even a policy
delivery effect does not establish transferable pixel perturbations.

The supplied notice is an experimental fixture; its wording is not attributed to
the actual original assessment's rules. Execution status and results belong in
experiment records, not the HPC usage manual.
