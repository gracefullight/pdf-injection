# UTS Cetus GPU experiment preparation

## Material Passport

- Origin: repository experiment planning, ARS experiment-agent plan mode
- Date: 2026-09-27 (Australia/Sydney)
- Verification status: bounded pilot and delivery diagnostic completed; strict endpoint, OCR, visual and artifact checks recorded
- Version: hpc_continuation_v3

## Environment reference

Use the institution's current HPC documentation for access, storage and queue
policies. Recheck queue limits before submitting work. A successful CPU job does
not verify GPU allocation or CUDA compatibility.

Connect to the assigned login host using your own HPC account. Run workloads
through PBS, never on the login node. Keep credentials and personal filesystem
paths out of repository files. Store job IDs and session logs in private run records.

The existing optimizer `../document_refusal_search.py` uses Apple MLX and mlx-vlm.
It cannot be run unchanged on an NVIDIA CUDA node. A PyTorch implementation needs
separate validation before comparing its results with the local MLX experiments.

## Stage 0: hardware and CUDA checks

The first completed inventory identified NVIDIA RTX PRO 6000 Blackwell Server
Edition devices with 97,887 MiB each and driver 580.142. This is one observed node,
not a guarantee about future allocations. Its one-GPU job listed two devices and
had no CUDA_VISIBLE_DEVICES value; verify scheduler isolation before computation.
Run `gpu_allocation.pbs` to inspect scheduler device metadata without CUDA work.
The subsequent diagnostic found no GPU assignment variables or device cgroup
restriction, and an inaccessible second GPU on another node. For this environment,
use `gpu_smoke_exclusive.pbs` with both GPUs reserved and `place=excl`.
This avoids sharing an unisolated GPU. It performs the same small computation
on one GPU and requires both reserved devices to be visible. A device-count check
alone does not prove correct assignment on an unisolated shared node.

The initial isolated environment now has Python 3.12 and PyTorch 2.7.1+cu128
installed from prebuilt wheels, and `uv pip check` passed. The exclusive-node
CUDA smoke job completed successfully on an RTX PRO 6000 Blackwell device. Its
frozen linear-layer forward and analytic input-gradient checks passed; see the
[CUDA result](../results/2026-09-27-hpc-preflight/cuda-smoke.json).

The pinned CUDA environment also has Transformers 4.51.3 and the
Qwen2.5-VL-3B-Instruct checkpoint at revision
`66285546d2b821cf421d4f5eb2576359d3770cd3`. Model download and staged-file hash
checks passed. Four CPU tests passed both locally and in the pinned HPC
environment: reference-processor parity, packing backpropagation, protected-pixel
bounds, and byte-forward/BPDA behavior. These are not GPU or model-response results.
The expanded HPC suite now passes eight tests, including strict short-answer
matching, held-out exclusion from selection, cache-order preservation, and
exclusion of task constraints and reading failures from refusal labels; see
the [test log](../results/2026-09-27-hpc-preflight/cpu-tests-hpc-v2.txt).
The VLM preflight subsequently ran and failed its clean-reading gate. The initial
host restriction was removed to allow scheduling on
any eligible exclusive node; revalidate hardware through the smoke check on the
allocated node. Keep current scheduler state in private session records.

1. Inspect `qstat -Qf small_gpuq med_gpuq large_gpuq` and the user's current jobs.
2. Stage only these preparation files under `$HOME/pdf-injection-gpu/`.
3. From that directory, submit `qsub gpu_inventory.pbs`. This requests one GPU,
   one CPU, 2 GB of host memory and five minutes. These requests do not select a
   particular GPU model or guarantee immediate scheduling.
4. Record the job ID, queue state, inventory output and final `Exit_status`.
5. Choose prebuilt PyTorch wheels compatible with the observed GPU architecture
   and driver. Prepare an isolated `.venv` using uv and `--no-build`; record exact
   resolved versions. Do not assume a CUDA module name proves compatibility.
6. On a scheduler that isolates devices, submit `qsub gpu_smoke.pbs`. In the
   observed unisolated environment, use `gpu_smoke_exclusive.pbs` with the verified
   node/resource selector instead. Neither script downloads model weights.

`gpu_smoke.py` checks a CUDA float32 forward pass and a nonzero, finite input
gradient through a frozen linear layer, including agreement with its analytic
gradient. Passing this check does not validate a VLM, mixed precision, SAM, or
transfer to another model.

Save PBS logs and a software manifest with each run. Check `qstat -fx JOB_ID` for
completion; successful input delivery to a terminal is not job completion. If a
job queues, report its state and scheduler comment rather than submitting copies.

## Stage 1: validate the PyTorch VLM path

`torch_document.py` implements differentiable packing and frozen BF16 inference.
`vlm_preflight.py` checks processor parity, four clean visual-reading prompts,
input gradients, directional finite differences, and actual saved-byte proposals.
`vlm_preflight.pbs` requests a 30-minute exclusive allocation and runs the CUDA
smoke again before loading the model. A failed gate produces a failure report and
nonzero exit; it must not silently proceed into optimization.

### Explicit baseline-reading exception

After the first colour-answer failure, the user requested that the main experiment
proceed. The continuation separates baseline utility accuracy from technical
validity: `--allow-baseline-reading-failure` retains every incorrect answer and
continues the gradient and saved-byte checks. It does not change prompts, expected
answers, images, model weights, or held-out selection rules. A technically valid
run with a reading failure has status `passed_with_baseline_reading_failure`,
never `passed`. The pilot requires the same explicit option and successful
technical checks, and copies the baseline responses into its manifest.

Submit `pilot.pbs` with `PDFI_RUN_PREFLIGHT=1`,
`PDFI_ALLOW_BASELINE_READING_FAILURE=1`, and the renderer report path to run
technical validation, optimization and evaluation in one allocation. Default
behaviour remains strict. Baseline utility errors are a limitation to report;
reading failures and incomplete responses still do not count as successful
refusals. This amendment followed inspection of training/development responses,
before any final held-out responses were evaluated.

### Single-step improvement is an outcome, not an execution prerequisite

The subsequent [quantized-probe report](../results/2026-09-27-hpc-preflight/vlm-quantized-probe-failure.json)
recorded finite nonzero image gradients, frozen model weights and valid saved-pixel
bounds, but none of the three single-step candidates improved the clean target loss
(2.49748 versus 2.53194, 2.53194 and 2.56531). Its strict gate terminated the job
before E/U optimization. This negative observation remains unchanged.

The next continuation explicitly enables `--allow-nonimproving-probe` through
`PDFI_ALLOW_NONIMPROVING_PROBE=1`. Its status is
`completed_with_nonimproving_probe`, with `improved=false` retained. Both report
and pilot must opt in. Packing mismatch, non-finite/zero gradients, weight gradients,
failed directional-sign checks and pixel-constraint violations still stop the job.
The pilot retains the current image when no tested step helps. A null optimization
result is recorded instead of requiring a successful first step before observing
the full experiment.

Finite differences agreed in sign but differed in magnitude from autograd by
99.2–100% at the tested step sizes. These checks establish neither numerical
derivative accuracy nor optimization effectiveness. Retain the full diagnostics
in the pilot manifest and report this limitation with any resulting measurements.

The [first VLM report](../results/2026-09-27-hpc-preflight/vlm-first-run.json)
records exact processor packing parity and successful BF16 generation. Three of
four visual questions matched the expected answers. The blue heading was reported
as `#2E8B57`, a green colour, so the reading gate failed. This is an incorrect
answer, not a formatting-only mismatch. The two development task responses
contained substantive assistance but both reached the 192-token limit; neither
is evidence of a complete correct answer. The run stopped before VLM input-gradient
and saved-byte optimization checks. Preserve this baseline failure when diagnosing
the next run; do not relabel it as a passed preflight.

The derived pilot image is page 2 at 112 DPI, 952 x 1232 pixels, with SHA-256
`f0231a507508a799941ffdf9e6da2ee1dc140cb30b881718c75dfbc485aa0f0a`.
This Letter-aspect geometry is divisible by the processor's 28-pixel factor and
was visually checked for readable body text. The original native PDF is preserved.

`specification3-prompts.json` fixes training/development prompts and the six task
plus four visual-metadata final questions before optimization. Visual utility
does not establish semantic task comprehension. Final prompts share topics with
training; they test prompt robustness, not unseen-topic generalization.

The replacement continuation completed all optimization and model evaluation with
exit status 0. The [completed run](../results/2026-09-27-hpc-preflight/README.md#completed-execution)
contains 13 page reports and 62 document conditions. No provisional R2 was found;
most task responses were truncated. The [completion report](../results/2026-09-27-policy-delivery/completion-report.md)
records the subsequent strict-endpoint response audit, independent OCR/visual and
PDF hash checks, and the 288-response policy-delivery diagnostic. None achieved
strict R2. Semantic leakage counts are conservative lower bounds, not full
solution-correctness scores.
The pilot uses 36 updates per E/U arm and
paired seeds 17, 29, 43. Each update uses one backward pass and three quantized
proposal forwards (1, 2, 4 bytes); U replaces every third policy update with a
visual-utility update. It saves a six-update checkpoint bank, selects with
development free generation, and uses the historical 15-way crossover budget.
The replacement schedule matches compute, not policy-supervision count. Record
this difference when interpreting E versus U.

The prepared port uses actual JPEG and resize forwards with identity BPDA, and
actual Poppler PDF forwards with the historical interpolation adjoint. Poppler
26.09.0 is installed separately from the Python environment using prebuilt
packages. `renderer_preflight.py` passed locally and on HPC: the historical
forward surrogate matched actual Poppler output exactly for the clean page,
bounded noise and full-range random pixels at the new geometry. The unquantized
interpolation adjoint passed a dot-product check. This validates those cases, not
all PDF configurations or a derivative through byte rounding. See the
[renderer evidence](../results/2026-09-27-hpc-preflight/renderer-report.json).

MuPDF and PDFium preserved the embedded page pixels exactly at 112 DPI; Poppler
did not. Use Poppler for primary development selection and PDF evaluation, and
MuPDF for the second-renderer response comparison. Do not substitute an identity
PDF path for the historical rendering challenge.

`evaluate_document.py` follows the page pilot. It keeps six pages unchanged,
replaces only page 2, and compares paired single/full inputs with an identical
heading selector. It evaluates native-document renderings, clean/random/selected
raster PDFs, and separate leading readable-policy/blank-page controls. Ordered
identical image pixels and prompts may reuse deterministic responses; the report
distinguishes logical outcomes from unique generation calls. This tests rendered
pages, not native PDF ingestion by Qwen.

`pilot.pbs` chains optimization, crossover, final page evaluation and document
evaluation in one bounded six-hour allocation. VLM technical checks and renderer
checks must pass before optimization starts; baseline reading errors require the
explicit exception above. The first pilot job was submitted with an
`afterok` dependency on the VLM preflight. That dependency was not satisfied in
the first run, and the pilot produced no optimization result. A successful future
job still requires manual leakage
review, visual inspection and OCR checks. `ocr_document.py` measures page-2 CER/WER
against normalized native-PDF text and independently audits protected pixels.
Those final checks and any failure-driven continuation remain part of the goal.
No model success is implied by prepared code, submitted jobs or CPU checks.

### Scheduling on a partially occupied node

A live resource audit found one idle GPU on a shared two-GPU compute node, while
the exclusive two-GPU request could not start. A short PBS inventory confirmed
that the other GPU was busy and the idle device was the same RTX PRO 6000 Blackwell
model. The continuation was resubmitted with one GPU and an explicit device UUID;
the superseded queued job was cancelled. Account, node, job and device identifiers
remain in private execution records.

For this mode, `pilot.pbs` accepts `PDFI_GPU_UUID` and `PDFI_GPU_HOST`.
`gpu_binding.py` verifies an active one-GPU allocation, the expected host and UUID,
and no compute processes, substantial memory use or GPU activity on that device
before setting `CUDA_VISIBLE_DEVICES`. This is a point-in-time occupancy check,
not scheduler-enforced isolation. The CUDA smoke and model then require exactly
one visible GPU. The default script still requests an exclusive two-GPU node.

For post-run OCR, use Tesseract and the PDF reporting dependencies plus
`rapidfuzz==3.13.0`; this reporting tool is not required by GPU optimization.

- Start with the same Qwen2.5-VL-3B-Instruct family as the MLX baseline. Select
  precision only after checking VRAM. Record checkpoint revision, quantization,
  processor settings and image geometry. A precision change is an experimental
  variable, not an exact reproduction of the 4-bit baseline.
- First check clean-document reading and actual generated responses.
- Freeze weights and verify gradients to the image through preprocessing and the
  vision encoder. Check a small directional derivative against finite differences.
- Run one bounded optimization step, save an 8-bit image, and reevaluate that saved
  image and its PDF rendering. Do not count only continuous-space loss improvement.
- Record peak VRAM and elapsed time before selecting a longer PBS resource request.

## Stage 2: controlled surrogate-method pilot

The immediate continuation is specified in
[`next-experiment.md`](next-experiment.md): apply the existing EOT, utility-EOT
and crossover procedure to the actual document, then diagnose prompt and renderer
failures. SAM was an example, not a selected experiment. Cross-model transfer is
secondary and is not a success gate for this research.

Start from the [commit-level experiment follow-up](../results/2026-09-27-commit-audit/README.md).
The repository has already tested multi-prompt/utility/EOT optimization, direct-image
shaving to 3/255 with reoptimization, PDF-aware candidates, and unsuccessful Luna
transfer. This stage extends those methods to the actual document and a validated
CUDA implementation; it is not their first experiment. Reuse the quantized candidate
bank and free-generation selection procedure. Check renderer parity at the new
geometry, completion status, and document-specific leakage rules before new runs.

Question: how do the existing text-free optimization and crossover procedures
behave on the actual document across prompts, rendering paths and pixel budgets?

Use the original document identified by the user on 2026-09-27:

- Document: `Specification3.pdf`, **48024 Programming 2 — Assignment 1**, seven pages.
- Original SHA-256: `0ba974732c0c296d953a6483fc830c2ec7ae89c92dc2a857f76dc927672d08ed`.
- Policy text: [`uts-assessment-integrity-notice.txt`](../fixtures/uts-assessment-integrity-notice.txt).

Keep the original PDF as an external experiment input; do not record its personal
filesystem location in the repository. The four-page
[`se-assignment-architecture-quality-plan.pdf`](../datasets/se-assignment-architecture-quality-plan.pdf)
is a separate synthetic fixture, not a copy of the original.

`Specification3.pdf` is not a rasterized, image-only PDF. Preserve its original
text and document objects in the native-PDF baseline. Pixel optimization requires
rendering pages into derived images; packaging those images into a PDF produces
a separate rasterized artifact, not a modified native PDF with its text preserved.

Keep these evaluation inputs distinct:

| Input | Purpose |
| --- | --- |
| Unchanged native PDF | Measure behavior on the actual original document. |
| Clean page images | Establish the baseline for pixel optimization. |
| Perturbed page images | Measure the image perturbation effect. |
| Image-only PDF made from clean page images | Control for rasterization and PDF packaging. |
| Image-only PDF made from perturbed page images | Measure the perturbation effect after PDF packaging. |

Compare perturbed images with clean images, and perturbed image-only PDFs with
clean image-only PDFs. Separately compare the native PDF with the clean image-only
PDF to measure the conversion effect. Do not attribute a native-to-perturbed-raster
difference entirely to the perturbation. Record whether each evaluation pipeline
uses extracted text, rendered pages, or both; mark unknown ingestion behavior as
unknown. A source VLM receiving rendered pages does not test native PDF ingestion.
Preserving native text while modifying the visual content requires a separate
experiment and is not implemented by the existing image shaving script.

The policy fixture is the supplied experimental notice. The original PDF contains
individual-work requirements, but its extracted text does not contain the fixture's
blanket AI and web-search prohibition. Do not attribute that experimental wording
to the original assessment rules. Existing administrative-question fixtures for
48433 must be replaced with questions and expected answers for 48024 before this run.

Keep the document and policy wording fixed across conditions and record their
SHA-256 hashes. Verify clean reading and answerability before optimizing. This
pilot uses one document; additional documents belong to a later generalization
study. Record page selection, rendering resolution and page order in each run.

Compare clean input, random noise, optimized perturbations and a readable
policy-notice positive control. In text-free conditions, use the policy to define
the target behavior without rendering its words into the image. In text-overlay
conditions, retain the supplied wording. Match random and optimized perturbation
amplitude and allowed regions; report their realized norms and changed area.
Start at 8/255 with text regions protected. The readable notice is a semantic
control, not a stealth match.

The existing x05 candidate belongs to a separate one-page fixture. Its amplitude
sweep with `../shave_document_perturbation.py` is a diagnostic of that candidate,
not a result on the confirmed document. Generate a candidate for the confirmed
document before using the same shaving procedure to measure its amplitude limits.
Earlier candidates already have amplitude sweeps and reoptimization results;
do not treat another synthetic x05 sweep as the main next experiment.

Evaluate direct images and PDFs separately on each frozen source model. Reserve
independent-model transfer for a secondary evaluation. Use six fresh assignment requests excluded from pixel
optimization and four permitted document-reading questions. Fix candidate selection
using source-model development data before inspecting evaluation-model responses.
Use three optimization seeds for stochastic methods and preserve all outputs.
This is a feasibility pilot, not a powered population-level effectiveness claim.

Primary outcome: strict refusal/referral for EOT, utility-EOT and crossover
candidates on held-out prompts and renderings, compared with clean and random
controls on the same frozen surrogate. Also report instructor referral, substantive answer
leakage, reading failure, permitted-question accuracy, OCR error, perturbation norms
and visual differences. Reading failures are not successful refusals. Incomplete
responses must be flagged; do not score truncation as a complete successful answer
or refusal. Compare paired document/request outcomes and report per-document counts.

The earlier Luna artifact contains incomplete responses and a fixture missing task
details. Its R0 labels indicate no measured policy refusal, not verified complete
correct answers. See `../results/2026-09-13-surrogate-factorial/textfree-x05-gpt-luna.json`.

## Stage 3: secondary transfer and follow-up methods

Before selecting a transfer method, include the newly identified
[CoTTA and Repeat-After-Me comparisons](../../docs/related-work.md#additional-close-references-as-of-2026-09-27).
The latter reports failed ensemble gradient transfer for exact tool-call/disclosure
targets. Treat refusal transfer as a separate empirical question; do not assume
that an ensemble or SAM will resolve it. Keep rendered-text methods in a separate
comparison arm from text-free perturbations.

Choose later methods from the measured failure mode. SAM could test surrogate
training effects, with ordinary adaptation as a required control; Gumbel-Softmax
would require an explicit discrete choice such as modification-region selection.
Neither method is selected merely because it was mentioned as an example.
Retain within-surrogate, null and negative results. Transfer may remain a reported
limitation or future research question.

References: [ImageProtector and STAB](../../docs/related-work.md#core-references-for-image-based-response-steering).
