# research/datasets

Policy and layout for datasets used by PDF Injection's Phase 3/4 research
workflows (provider benchmark, submission-detection calibration).

## Hard policy: no real student data

Per PRD §19.4 (Privacy) and §20 (Ethical and Governance Requirements):

- **This MVP does not accept real student submissions.** `POST
  /api/v1/jobs/:jobId/submissions` requires
  `acknowledgeNoRealStudentData: true` and is gated behind
  `PDFI_RESEARCH_MODE=true`; it is a research-protocol scaffold, not a
  production intake path for actual coursework.
- Any dataset committed under this directory, or referenced by a
  `research/experiment-configs/*.json` config, **must be synthetic** —
  generated or hand-written text that does not originate from a real
  student's work.
- If a study with real students is ever conducted, it requires prior
  ethics/IRB review (PRD §20 item 6) and must not reuse this MVP's storage
  or logging paths as-is; that is out of scope for this repository.
- Keys, hidden instructions, and student identifiers are never logged
  server-side (PRD §14 Private Manifest / §19.4) — datasets here should
  follow the same discipline: don't commit real names, emails, or student
  IDs, synthetic or otherwise, without a clear synthetic-data label.

## Adding a synthetic baseline

A "baseline" dataset is a set of `SubmissionLabel: "baseline"` texts — i.e.
known-original (non-injected-instruction-following) responses used to
measure the false-positive rate of `packages/detector`'s scoring
(`calibrate()`, `binomialTestVsBaseline`, PRD §23.2 "Original PDF
false-positive rate가 낮음").

1. Create a subdirectory, e.g. `research/datasets/<name>/`.
2. Add one `.txt` or `.md` file per synthetic sample, plus a
   `manifest.json` listing:
   ```json
   {
     "name": "<name>",
     "synthetic": true,
     "generatedBy": "how these were produced (e.g. hand-written, LLM-authored with a described prompt)",
     "count": 0,
     "notes": "what expected signals / methodology labels these were designed to NOT contain"
   }
   ```
3. Reference the dataset from a `research/experiment-configs/*.json`
   `notes` field, or from a `textSource: { kind: "custom", texts: [...] }`
   robustness/submissions run — this directory itself is not wired into any
   automated loader; it's a place to keep inputs reproducible and reviewable.
4. Keep baseline and candidate (injected-condition) samples in clearly
   separate subdirectories/files so calibration math (packages/detector) is
   never accidentally run against mislabeled data.

No datasets are checked in yet — add one following the layout above when a
concrete experiment needs it.
