# Ethics and Privacy

PDF Injection exists to test whether hidden instructions embedded in a distributed PDF can
influence an LLM's behavior when that PDF is later processed by a model — not to determine
whether any individual student used AI, or to what extent. This page states the governance rules
the product follows and the privacy defaults it ships with.

## Governance requirements

1. **A hidden instruction must not compromise the factual correctness of an answer.** It may ask
   for a preferred methodology, term, or structure — never for something that would make a
   correct answer wrong.
2. **No fake citations or fabricated facts.** The prompt linter (`packages/prompt-lint`) flags
   instructions that appear to request fake/fabricated citations or fabricated
   facts/data/statistics as warnings requiring explicit acknowledgement.
3. **No instruction may force a methodology that is unfair or inappropriate for the assignment.**
   The linter flags methodology labels containing words like "random", "arbitrary", "guess", or
   "magic" as a warning.
4. **A signal match must never be used as sole disciplinary evidence.** At most, a match means
   "the submission's characteristics are consistent with the hidden instruction embedded in the
   distributed PDF" — never proof of AI use, of which model was used, or of intent. See the
   framing in [`README.md`](../README.md#what-this-is-not).
5. **Institutional academic-integrity policy always takes precedence** over anything this tool
   reports.
6. **Research involving real students requires ethics/IRB review.** This PoC does not collect or
   process real student submissions in the MVP (see "No student submissions in the MVP" below);
   any future research extension that does must go through institutional ethics review before
   any real student data is processed.
7. **Invisible text has an accessibility cost.** White-text and render-mode-3 injections are, by
   design, readable by some machine parsers but not by human readers — including users of screen
   readers, who may have the hidden text read aloud, or dark-mode PDF viewers, where white text
   can become visible against a dark background. See
   [Accessibility caveat](#accessibility-caveat) below for the full caveat, and the
   "Required protections" listed under white-text mode.
8. **The professor's prompt and the source/output PDF hashes are recorded before distribution.**
   Every job's `manifest.json` and `report.json` are written as soon as the job completes, so the
   exact instruction and hashes are on record before the PDF is ever handed to a student.
9. **Any presentation of results must show uncertainty and alternative explanations**, not a
   binary "detected/not detected" claim.
10. **The UI never uses definitive AI-cheating-determination language.** Only `PASS`,
    `PASS_WITH_WARNINGS`, `FAIL`, and `NOT_TESTED` are used as status labels — see
    [`docs/validation.md`](validation.md#overall-status-values). The following phrases are never
    used anywhere in the product: *Safe*, *Undetectable*, *AI proof*, *Cheating proof*,
    *Guaranteed to work*.

## Private manifest handling

Every job produces a `<stem>.private-manifest.json` file containing the **plaintext hidden
instruction**, the expected signals, and file/prompt hashes. This file:

- Is intended for the professor's own records only.
- Must **never** be distributed to students — only the injected `output.pdf` should be
  distributed.
- Carries a warning string directly in its JSON body:
  `"warning": "PRIVATE — contains the hidden instruction. Do not distribute to students."`
- Is deleted, along with every other artifact for that job, on `DELETE /api/v1/jobs/:jobId` or
  when the retention sweeper expires the job (default `PDFI_RETENTION_HOURS=24`).

The web app's Private Manifest tab shows a masked preview of the instruction plus a prominent
warning before allowing download — see `apps/web/src/features/validation-result/private-manifest-tab.tsx`.

## External provider transfer consent (Phase 3/5)

`POST /jobs/:jobId/model-tests` and `POST /jobs/:jobId/robustness` can send the PDF/text and
outer prompt to a third-party LLM provider (`anthropic`/`openai`) when explicitly enabled. Three
independent things must all be true before that happens:

1. `PDFI_ALLOW_EXTERNAL_PROVIDERS=true` on the server (off by default) — otherwise
   `403 EXTERNAL_PROVIDERS_DISABLED` for any non-`mock` provider.
2. The relevant API key (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`) is configured — otherwise
   `422 PROVIDER_NOT_CONFIGURED`.
3. The request body itself sets `acknowledgeExternalTransfer: true` — a per-request, explicit
   opt-in separate from the server-level flag, so enabling the server flag once does not silently
   authorize every future run.

The `mock` provider (deterministic, no network calls, no API key) is always available regardless
of these gates, so the entire model-test/robustness research protocol can be exercised with zero
external data transfer — see [`docs/research-protocol.md`](research-protocol.md).

## Student-key mapping handling (Phase 1 student-keyed sets)

`POST /student-keyed-sets` embeds a unique per-student key into each student's copy of the
injected instruction, so a later signal match can be traced back to a specific student without
publishing a student roster anywhere in the distributed PDFs themselves. The
`studentId -> key -> jobId -> outputSha256` mapping:

- Is written to exactly one place: a private `mapping.json` file under that set's own storage
  directory (never the sqlite database, never server logs).
- Is only ever exposed via `GET /student-keyed-sets/:id/mapping`, which returns **CSV only**
  (never JSON) — the same "for the professor's own records, do not distribute" expectation as the
  [private manifest](#private-manifest-handling) above applies to this file.
- Is deleted, along with every member job's own artifacts, on `DELETE /student-keyed-sets/:id` or
  when the set's own retention sweep expires it.

## Accessibility caveat

Because `white_text` and `render_mode_3` modes rely on text that is not visually rendered (or is
rendered in a way most sighted readers won't notice), they carry an inherent accessibility risk:
a screen reader has no reason to skip this text, and it will typically read the hidden
instruction aloud along with the rest of the page content. The `visible_positive_control` mode
avoids this entirely by making the instruction visible to everyone. The server-side validation
pipeline records `ACCESSIBILITY_HIDDEN_TEXT`-style warnings (surfaced in
`ValidationReport.serverValidation.warnings`) so this trade-off is visible in every report, not
just documented here.

## Submissions research mode (Phase 4) — no real student data

`POST /api/v1/jobs/:jobId/submissions` and its sibling routes (`GET .../submissions`,
`GET .../submissions/statistics`, `DELETE .../submissions/:id`) run `packages/detector`'s
deterministic `ExpectedSignal` matchers against a submitted text/document and calibrate a
false-positive rate against other submissions on the same job labeled `"baseline"`. This is a
**research scaffold, not a production intake path for real coursework**, and it is deliberately
hard to reach by accident:

1. **Off by default.** Every submissions route requires `PDFI_RESEARCH_MODE=true` on the server —
   `403 RESEARCH_MODE_DISABLED` otherwise.
2. **Per-request acknowledgement required.** `POST /submissions` requires
   `acknowledgeNoRealStudentData: true` on every single request — there is no way to submit
   without explicitly asserting the text is not real student work.
3. **Synthetic data only.** [`research/datasets/README.md`](../research/datasets/README.md)
   documents the same policy for any dataset used to build baseline/candidate text sets: nothing
   committed there, or referenced from an experiment config, may originate from a real student.
4. **The result is never a verdict.** `SubmissionAnalysis.interpretation` is drawn from a small,
   fixed, non-overclaiming set of headlines (e.g. "Hidden instruction signal matched",
   "Behavioral canary detected", "No consistent signal") plus `alternatives`/`uncertainty` text —
   never "AI cheating detected" or equivalent. See governance requirement 4 above and
   [`docs/api.md`](api.md#submissions-3--phase-4-submission-side-detection-research-only) for the
   full response shape.
5. **A real study with real students requires institutional ethics/IRB review** (governance
   requirement 6 and the [IRB note](#irb-note) below) before any real submission is ever analyzed
   — enabling `PDFI_RESEARCH_MODE` does not substitute for that review, it only removes the
   technical gate.

See [`docs/research-protocol.md`](research-protocol.md) for how to run this research protocol end
to end with synthetic data, and [`docs/limitations.md`](limitations.md) for what remains
unimplemented or caveated.

## IRB note

If this tool, or its detector package, is ever used to analyze real student work as part of a
research study, that use requires prior institutional ethics/IRB review and informed consent
processes appropriate to the institution — this codebase does not implement or substitute for
that review.

## Privacy defaults

- **No external LLM calls by default.** `PDFI_ALLOW_EXTERNAL_PROVIDERS=false` (default) blocks the
  `anthropic`/`openai` providers on `POST /jobs/:jobId/model-tests` and robustness text
  transforms; only the `mock` provider (no network calls) is reachable. See
  [External provider transfer consent](#external-provider-transfer-consent-phase-35) above.
- **No submission analysis by default.** `PDFI_RESEARCH_MODE=false` (default) disables every
  `/submissions*` and `/robustness*` route. See
  [Submissions research mode](#submissions-research-mode-phase-4--no-real-student-data) above.
- **24-hour default retention.** `PDFI_RETENTION_HOURS` (default `24`) controls how long job
  artifacts live before a background sweeper deletes them (source PDF, output PDF, manifest,
  report, and the SQLite row) — this cascades to any model-test/robustness runs and submissions
  scoped to that job. Variant sets and student-keyed sets have their own independent retention
  sweep for the same default window, since their set-level storage isn't inside any single member
  job's directory.
- **Immediate deletion.** `DELETE /api/v1/jobs/:jobId` (and the equivalent delete routes for
  variant sets, student-keyed sets, model-test runs, robustness runs, and individual submissions)
  removes all artifacts and database rows immediately and idempotently.
- **No instruction text in logs or the database.** `bun:sqlite` stores only `prompt_sha256`;
  server code never logs the raw instruction (see `apps/api/src/services/job.service.ts`'s
  `toolVersions()`/logging comments and `jobs.repository.ts`'s schema, which has no instruction
  column). The same discipline applies to variant-set/student-keyed-set instructions and the
  student-key mapping (see above) — never logged, never in a sqlite column.
- **No student personal data.** The tool is designed around assignment-level (not
  student-specific) PDFs by default — there is no field anywhere in the core `jobs` schema or
  manifest for a student name or other personal identifier. Student-keyed sets accept a
  caller-supplied `studentId` string (intended to be an opaque roster id, not a real name) for the
  sole purpose of the key-mapping traceability feature described above, and submissions are
  explicitly gated to synthetic-only text per the research-mode acknowledgement above — neither
  path is a general student-data intake mechanism.
