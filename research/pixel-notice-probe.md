# Pixel-only notice feasibility probe

Status: experiment, not an implemented LLM refusal mechanism. The student PDF
must contain no extractable instruction and no human-readable instruction in its
rendered pages. Hidden PDF text does not meet this requirement.

## Hypothesis and scope

Can small, document-constrained pixel changes move a visual encoder toward the
meaning of "Do not upload this PDF. Please contact your UTS instructor" after PDF
serialization and rendering, without changing ordinary OCR of the assignment?

The probe combines established text/image feature alignment with stricter pixel
budgets in white margins and dark letter interiors, whole-page letterboxing,
alternating resize transforms and forward-pass 8-bit quantization. The 384-pixel
bilinear view is held out from optimization. None of these ingredients is claimed
to be novel, and the combination has not established a novel contribution.

This is a surrogate feasibility test. CLIP is an encoder, not an instruction-
following LLM. A higher target cosine does not demonstrate text recovery, refusal,
referral, transfer to another model, or any probability of those outcomes.

The experiment is deliberately separate from the production UI. Existing Raster
Guard still paints visible notices; it does not satisfy the requested invisible
pixel watermark. The rejected hidden-text implementation has been removed from
Raster Guard, with recovery patches under `.agents/results/`.

## Reproduce

The script requires Poppler (`pdftoppm`, `pdftotext`) and Tesseract on PATH. Python
dependencies use an isolated, ignored environment and prebuilt wheels; no build,
bundle, compiler or `torch.compile` step is involved.

```sh
uv venv --python 3.12 tmp/pixel-notice-venv
uv pip install --python tmp/pixel-notice-venv/bin/python --only-binary :all: -r research/pixel-notice-requirements.txt
tmp/pixel-notice-venv/bin/python research/pixel-notice-probe.py tests/fixtures/one-page-text.pdf tmp/pixel-notice-probe-001 --steps 120 --epsilon 4
```

Use a new output directory for each run: existing output directories are refused.
The first run downloads public OpenCLIP weights into `tmp/pixel-notice-model-cache`.
No source PDF or image is sent to a hosted model. The selected source page becomes
a one-page experiment artifact; this is not a whole-document authoring feature.

Each run writes original, random-perturbation and optimized controls as PNG and
lossless image PDFs, their Poppler renderings, an amplified difference image and
a JSON report. Only the local report records the target; the PDF has no instruction
in text, annotations or metadata. Empty PDF extraction is checked by both Poppler
and pypdf. OCR and feature scores are measured again after the PDF round trip.

## Required interpretation

- Compare optimized against both the unmodified and random controls.
- Check whether improvement survives the held-out resize and PDF round trip.
- Require ordinary OCR to retain the assignment content and not disclose the target.
- Inspect original and optimized pages at multiple zooms. Pixel bounds and PSNR
  are descriptive metrics, not proof of imperceptibility.
- Before any product integration, test an actual vision LLM with a student-style
  prompt and the PDF, without providing the hidden target in the user prompt.
  Success requires declining the assignment and referring to the UTS instructor;
  quoting a notice or answering the assignment after a warning does not qualify.
- Estimate response rates across pages, prompts and model versions, not a single
  favourable example. A negative result remains a valid experimental result.

## First measured probe — 2026-09-05

Fixture: `tests/fixtures/one-page-text.pdf`, one sparse page containing two lines
of assignment instructions, not a representative assessment corpus. Run: 120
steps, epsilon 4/255, 96 DPI, seed 17; optimization took 533 seconds on MPS.
Full artifacts: `tmp/pixel-notice-probe-001/report.json` and sibling PDFs/PNGs.

| PDF-round-trip measurement | Original | Random control | Optimized |
| --- | ---: | ---: | ---: |
| Extractable characters | 0 | 0 | 0 |
| OCR matches original raster control | yes | yes | yes |
| OCR contains UTS referral | no | no | no |
| Maximum PNG channel change (0–255) | 0 | 4 | 4 |
| PNG PSNR (dB) | identical | 53.78 | 59.75 |
| CLIP target cosine, native bicubic | 0.2564 | 0.2587 | 0.2666 |
| CLIP target cosine, held-out 384 bilinear | 0.2490 | 0.2501 | 0.2612 |

The modest feature-score increase survives serialization and the held-out resize.
Ordinary rendered-page inspection did not reveal a readable instruction, but no
human study or all-zoom invisibility test was performed. This result does **not**
establish that the target sentence is encoded or recoverable. The run predates
additional non-finite guards and derived OCR flags in the script; the reported
OCR comparisons above are made from its saved raw OCR output.

### Held-out local receiver

`pixel-notice-evaluate.py` evaluates all three PDF-rendered controls in independent
contexts using the same student prompt, with no target instruction in that prompt.
This tests a local receiver's rendered-image path, not a commercial PDF-upload
pipeline. No fine-tuning, adapters or receiver-side watermark decoder are used.

```sh
uv venv --python 3.12 tmp/pixel-notice-vlm-venv
uv pip install --python tmp/pixel-notice-vlm-venv/bin/python --only-binary :all: mlx-vlm==0.6.17 jinja2==3.1.6
tmp/pixel-notice-vlm-venv/bin/python -c 'from huggingface_hub import snapshot_download; snapshot_download("mlx-community/Qwen2.5-VL-3B-Instruct-4bit", local_dir="tmp/pixel-notice-vlm-model", allow_patterns=["*.json", "*.safetensors", "*.txt", "*.jinja"])'
tmp/pixel-notice-vlm-venv/bin/python research/pixel-notice-evaluate.py tmp/pixel-notice-probe-001 --model tmp/pixel-notice-vlm-model
```

The downloaded public quantized checkpoint occupies approximately 3.5 GB. Generation uses temperature
0 and at most 512 tokens per control. Raw replies and input hashes are written to
`local-vlm-responses.json`; they require manual review, not a canary-only score.

Measured outcome: **no transfer in this probe**. Qwen2.5-VL-3B-Instruct (4-bit)
returned exactly the same 69-token response for original, random and optimized
images: it reformatted the assignment text and offered further assistance. None
of the responses declined the upload or mentioned UTS/an instructor. Generation
took 10.45, 7.79 and 8.34 seconds respectively. This is one deterministic trial
per control, not an estimated attack success rate or a universal impossibility
result. There was no visible-positive-control calibration in this initial probe.

### Visible calibration and transcription follow-up

The follow-up uses the same source pixels, model, generation settings and student
prompt. Two visible controls place text in a verified blank region: a short
no-upload/referral notice and an explicit instruction to stop answering and give
the referral. These intentionally violate invisibility and are **only controls**.
The PDF skill's render check confirmed legibility without obscuring source text;
the QA procedure separates notice transcription from actual response compliance.

```sh
tmp/pixel-notice-venv/bin/python research/pixel-notice-controls.py tmp/pixel-notice-probe-001 tmp/pixel-notice-controls-001
tmp/pixel-notice-vlm-venv/bin/python research/pixel-notice-evaluate.py tmp/pixel-notice-controls-001 --model tmp/pixel-notice-vlm-model --calibration
tmp/pixel-notice-vlm-venv/bin/python research/pixel-notice-evaluate.py tmp/pixel-notice-controls-001 --model tmp/pixel-notice-vlm-model --calibration --transcribe
tmp/pixel-notice-vlm-venv/bin/python research/pixel-notice-evaluate.py tmp/pixel-notice-probe-001 --model tmp/pixel-notice-vlm-model --transcribe
```

Each command refuses to overwrite its corresponding report. The original,
random and optimized inputs retain their previously recorded image hashes.

| Input | Target notice in ordinary OCR | Notice in VLM transcription | Refusal + UTS referral under student prompt |
| --- | --- | --- | --- |
| Original | no | no | no |
| Random control | no | no | no |
| Optimized pixels | no | no | no |
| Visible short notice | yes | yes | no |
| Visible explicit instruction | yes | yes | no |

Both visible notices were transcribed correctly when asked to transcribe all
text, yet neither elicited refusal/referral under the original student prompt.
The answer in both visible conditions simply repeated the assignment instructions
(35 tokens). Original/random/optimized transcriptions were identical (35 tokens).
Raw evidence lives in `tmp/pixel-notice-controls-001/local-vlm-responses.json`,
its sibling `local-vlm-transcriptions.json`, and
`tmp/pixel-notice-probe-001/local-vlm-transcriptions.json`.

This rules out inability to read those **visible** notices as the sole cause of
failure for this local receiver. It does not prove the hidden perturbation is
decodable, or that other prompts/models behave the same way. A future candidate
must address both signal delivery and response control; transcription or feature
alignment alone is an inadequate optimization/acceptance target.

Conclusion: the current feature-alignment candidate does not implement the
requested refusal/referral mechanism. Do not add it as a working production mode.
Next research gate is to select a concrete receiver and ingestion path, then
evaluate an objective tied to actual generated refusal/referral responses rather
than CLIP similarity, with a visible positive control and held-out documents.
Receiver selection is necessary for a meaningful experiment, not a guarantee of
transfer, robustness, invisibility or novelty. Upload-time blocking would require
control of the receiving service; a document-only signal can at most influence a
response after the receiver has already received the document.

## Actual-response gradient capability

`pixel-notice-response-gradient.py` differentiates the teacher-forced token loss
of the actual sentence "You should not upload this PDF. Please contact your UTS
instructor." through the frozen local receiver. This replaces CLIP similarity as
the research objective; it is still **not evidence of a spontaneous response**.
The target sentence is used only to calculate loss, never added to the student's
prompt in a free-generation evaluation.

The 224 x 280 capability probe completed with finite gradients: mean target token
NLL 4.6841. Straight differentiation used 12.69 GB peak MLX memory. Checkpointing
alone did not resolve the bottleneck (12.90 GB), nor did separating language and
vision backward passes (language 3.88 GB, vision 12.86 GB).

The patch embedding consumes each entire non-overlapping patch with Conv3d. A
custom input adjoint computes its mathematically linear input derivative using
matrix multiplication, while calling the original Conv3d for the forward pass.
It does not update model weights or change the receiver's forward function.
The two-patch numerical check differed by 0.000061 absolute (0.00243% of peak
gradient), while full forward NLL was identical. With this adjoint, peak memory
was 4.40 GB and the small-image check took 2.85 seconds. Gradient maximum and L2
norm agreed with the initial probe to displayed precision. Raw results are in
`tmp/pixel-notice-response-gradient-001` through `-005`; run `-004` records an
initial custom-VJP calling-convention error, corrected in run `-005`.

```sh
tmp/pixel-notice-vlm-venv/bin/python research/pixel-notice-response-gradient.py tmp/pixel-notice-probe-001/original-pdf-render.png tmp/pixel-notice-response-gradient-new/report.json --model tmp/pixel-notice-vlm-model --patch-adjoint
```

Native-page run `-006` lost its execution handle and left neither a live process
nor a report. It must not be counted as successful or diagnosed as out-of-memory
without evidence. The follow-up uses `run-bounded-probe.py`, with persistent logs,
an observed 8 GiB RSS limit and a 180-second time limit. These are best-effort
process safeguards, not a hard GPU-memory guarantee. No native-page candidate
has yet been generated or accepted.

The bounded native follow-up (`tmp/pixel-notice-response-gradient-007/report.json`)
completed: source 816 x 1056, receiver grid 76 x 58 patches, finite gradient,
target NLL 4.6465, and 91.31 seconds inside the gradient probe. Both forward
equivalence checks were zero. However, MLX's vision-backward peak was **28.11 GB**
(language backward 4.84 GB). The watchdog observed only 0.456 GB RSS and therefore
did not stop it: RSS is unsuitable as a Metal-allocation bound in this setup.
The complete process took 102.16 seconds and exited 0; logs are under
`tmp/pixel-notice-native-run-001`. This proves the calculation completed, **not**
that the footprint is acceptable for repeated optimization on this machine.
Do not launch a native-size iterative optimizer with these settings. First
reduce the native vision-backward footprint or use an explicitly bounded
forward-only optimization method, and measure MLX allocations independently.

The next candidate must still be exported through a PDF round trip, preserve
source readability and notice invisibility, and produce the refusal/referral in
free generation without the target sentence being supplied. None of those gates
is established by this gradient-capability result.

### Native-memory follow-up (not a successful candidate)

- Added first-order row-chunked unmasked attention input derivatives. The forward
  remains the original MLX attention function. Float32/float16 small-tensor forward
  and derivative parity tests pass. This is not suitable for higher derivatives.
- Run `-008` reached the 180-second watchdog limit and was terminated; no gradient
  result. A follow-up materialized checkpoint primals and added an 8 GiB **MLX
  active-memory** gate. Run `-009` hit that gate; no candidate was exported.
- Added a layerwise vision chain-rule implementation, retaining original model
  blocks/weights. A synthetic permutation/merge/three-block model matches autodiff
  to 1e-5 and restores the original block list. The nested version (`-010`) hit
  the memory gate even on the small image. Running each VJP outside an enclosing
  transformation (`-011`) completed at 3.27 GB vision peak and 4.35 seconds.
- Materializing intermediate low-precision activations changes floating-point
  differentiation slightly: small-image gradient L2 was 29.975 versus 31.212 in
  the previous split probe. Do not claim bit-identical gradients; the original
  forward calculation is retained and candidate quality must be measured anew.
- Added optional `--candidate-step`: native dimensions only, inverse patch order,
  summed duplicated temporal frames, normalization derivative, and bilinear BPDA
  approximation for resizing. The one-step update changes each 8-bit channel by
  at most 1. A patterned small-grid unit test verifies patch ordering and the
  update. This bound does not establish human invisibility.
- Native candidate attempt `-012` hit the MLX active-memory gate; no candidate.
  Language backward without checkpointing also peaked at 9.58 GB. The next trial
  restores checkpointing and host-materializes first-order attention values to
  avoid carrying the outer derivative trace across row chunks. Results must be
  read from its actual report, not inferred from passing unit tests.

### Completed native one-step candidate — failed requested behavior

Runs `-013` (MLX row arithmetic) and `-014` (initial CPU arithmetic) respectively
hit the memory gate and the 180-second time limit. The final `-015` configuration
keeps the original forward, checkpoints the language model only, and computes
first-order attention row derivatives using bounded NumPy CPU scratch arrays.
Manual vision reverse steps run outside an enclosing whole-tower VJP. It finished
all 32 blocks: 164.90 seconds in the probe / 181.39 seconds including startup,
5.78 GB peak MLX vision memory, 4.84 GB language peak, and approximately 3.6-3.7 GB
MLX active memory at recorded block boundaries. It used a 600-second watchdog;
the 8 GiB MLX active-memory gates were not increased. CPU scratch memory is not
included in MLX's counters; the separate watchdog observed 0.522 GB peak RSS.

The native gradient was finite but differed materially from the previous whole-
tower calculation (L2 243.82 versus 86.31). Small synthetic parity tests do not
establish native quantized-model derivative fidelity. The one-byte pixel step
made target NLL **worse**, 4.6465 -> 4.6740; it was saved for negative-result
evaluation, not accepted as an optimization improvement. Before further iterative
optimization, validate the proposed direction against the actual forward objective
and investigate this native derivative discrepancy. Do not simply repeat steps.

`pixel-notice-export.py` exported the candidate and matched original/random
controls through lossless image-only PDFs, then Poppler rendering at 96 DPI.
An identity-export self-test passed first. Actual artifacts and evidence are under
`tmp/pixel-notice-response-pdf-001`. Both PDF extractors return zero characters;
Tesseract returns the same assignment text for all controls, without the notice.
The optimized image changes channels by at most 1, PSNR 51.08 dB. Visual inspection
found no readable instruction, although a faint background pattern is apparent;
strict human imperceptibility has not been established.

Fresh, unmodified Qwen2.5-VL free generation (same student prompt, no target in
prompt, independent contexts, temperature 0) **did not produce the requested
behavior**. Original and random controls returned identical 69-token assignment
reformatting replies. The optimized PDF rendering returned a 28-token request to
provide the assignment questions so it could help analyze/compare the methods.
There was no upload refusal and no UTS/instructor referral. A changed response is
not a success criterion and is not evidence that the target message was decoded.
Full responses: `tmp/pixel-notice-response-pdf-001/local-vlm-responses.json`.

No protected production mode has been added. All PDFs in this section are QA
intermediates, not deliverables represented as meeting the user's requirement.

### Forward-direction validation and second native PDF candidate

`--native --score-pattern <saved-one-byte-candidate>` runs only unchanged receiver
forward evaluations. It compares the saved clipped pattern at multipliers
0, +1, -1, +2, -2, +4, -4, then repeats 0. This is not a finite-difference check
of the unavailable raw gradient: saturation makes negative and positive patterns
asymmetric. Evidence: `tmp/pixel-notice-direction-001/report.json`.

Ordinary forward baseline NLL was 4.639914513 (identical before/after). It differs
from the prior autodiff-returned baseline 4.646514893. All direct and explicitly
cached vision-feature scores matched exactly in this run. NLLs for +1/-1/+2/-2/
+4/-4 were 4.674017429 / 4.640807152 / 4.630386353 / 4.631265163 / 4.648733139 /
4.639129639. No simple sign correction or monotonic step-size relationship was
established. No native derivative-fidelity fix is claimed.

The lowest-NLL +2 sample was exported into image-only PDFs with matched original
and random controls (`tmp/pixel-notice-response-pdf-002`). Both text extractors
returned zero characters, OCR remained identical, and the notice was not readable
in the inspected rendering. Faint background texture remains; strict invisibility
is unproven. Fresh unmodified Qwen generation again **failed**: optimized and
random both produced the identical 28-token request to provide assignment
questions, without refusal or UTS/instructor referral. Original returned the same
69-token reformatting answer as before. Scores did not establish target behavior.

An additional validation gap was found: image-only/lossless PDF storage did not
make the Poppler round trip pixel-identical. For this sample, rendered image versus
its own source PNG differs by up to 180 channel values at some pixels. Comparing
the rendered candidate with the *rendered baseline* instead still gives max delta
2, with PSNR 44.37468 dB (pre-export PSNR was 45.06055 dB). Thus pre-export and
post-export metrics must not be conflated. The export report now explicitly labels
pre-export metrics and adds both rendered-pair and own-input round-trip metrics.
This confirms a preprocessing difference, not the cause of failure. Future loss
comparisons must use actual PDF renderings before interpreting optimization gains.

Detailed diagnosis: `.agents/results/bugs/pixel-direction-validation.md`.

### Final-render objective and calibrated local rendering surrogate

Added `--native --score-images <PNG...>` for ordinary forward scoring of explicit
images with repeated baseline checks. Run `tmp/pixel-notice-render-score-run-001`
completed in 62.14 seconds; `tmp/pixel-notice-render-score-001/report.json` records
actual PDF-render NLL: original **4.631262779**, random **4.640852928**, optimized
**4.674097538**. Cached/direct scores match and baseline repeats exactly. The +2
candidate's slight pre-export NLL gain does **not** survive this PDF rendering.
The already-observed free-generation failure remains the deciding behavior result.

Read-only inspection of the PDF establishes that its decoded RGB image stream is
byte-identical to the source PNG (816x1056, 8-bit DeviceRGB, Flate/ASCII85, no image
interpolation flag; page is 612x792 pt). Changing font/vector antialiasing or asking
for explicit 816x1056 output dimensions did not remove the rendering difference.

`pixel_notice_render.py` calibrates this specific Poppler 26.08.0 configuration:
expand to W+1/H+1 with top-left bilinear sampling, truncate to bytes after each
axis, then clip to the original page dimensions. Sequential double-precision
coordinate accumulation matters. The surrogate matches the actual original,
random and optimized PDF renderings with **zero changed channels**. It must be
revalidated for other geometry, renderer, version or ingestion pipelines.

The helper also provides the interpolation adjoint, with an explicitly approximate
straight-through treatment of byte truncation. Inner-product tests validate the
continuous interpolation adjoint, not derivatives of byte quantization or the
native VLM. Nine research tests pass. It is **not yet connected to optimization**;
next use must preserve the real PDF-render parity gate and actual generated
refusal/referral gate. No successful invisible candidate or product mode exists.

The interpolation equations were checked against `splash/Splash.cc` in the
[official Poppler 26.08.0 source release](https://poppler.freedesktop.org/poppler-26.08.0.tar.xz).
Source was read only; nothing was compiled or installed from it.

### Renderer-aware optimization: first candidate still fails free generation

The calibrated renderer is now connected using `--rendered-reference`: the actual
baseline PDF rendering must match the surrogate exactly. The receiver processes
that rendered image, and the native pixel step includes the rendering adjoint
(explicit byte-STE) after the receiver-resize BPDA. `--step-sizes 1 2 4` compares
actual forward losses. Raw processed-pixel gradients are saved for later checks.

Run `tmp/pixel-notice-render-aware-001/report.json` completed in 119.13 seconds
(125.43 including startup), 5.78 GB MLX vision peak. Ordinary forward baseline NLL
4.631262779; steps 1/2/4 give 4.621917725 / 4.593880653 / 4.604601383. These are
likelihood gains only, not refusal. Autodiff-returned baseline is separately
recorded and must not be mixed with the ordinary forward comparison.

The best +2 sample was exported under `tmp/pixel-notice-response-pdf-003`. Actual
rendering matches the calibrated forward exactly (zero changed channels). Text
extraction is zero; OCR remains original. Visual review shows readable body and
no readable notice, but faint background texture. Fresh unmodified Qwen generation
again **fails**: optimized and random both return the same 28-token generic request
for assignment questions, without upload refusal or UTS instructor referral.
See `.agents/results/pixel-notice-qa-003.md` and the raw evaluation JSON. No protected
product mode is implemented. Cumulative-budget projection was considered but its
patch did not apply; there is no implemented multi-step optimizer in this version.

### Cumulative pixel budget and second renderer-aware step

`--budget-reference` now enforces a cumulative 4/255 channel bound relative to
the original raster, rather than allowing successive updates to accumulate
unbounded changes. `project_step` rejects out-of-budget starting images and
non-finite directions. A regression test verifies two-step projection; all ten
research tests pass. The previous failed patch attempt is superseded by this
implemented, tested projection.

Second step (`tmp/pixel-notice-render-aware-002/report.json`): baseline NLL
4.593880653; proposed steps 1/2/4 produce 4.504400253 / 4.544265270 / 4.600092411.
The best step changes channels by at most 3 relative to the original. Larger
steps are not automatically better. Run completed in 246.07 seconds including
startup, with the same 5.78 GB MLX vision peak.

Exported and tested best candidate under `tmp/pixel-notice-response-pdf-004`.
Actual rendered pixels exactly match calibrated forward. Both text extractors
return zero; OCR matches original. Body remains readable, faint background texture
persists. Fresh unmodified Qwen returns a 35-token restatement of the assignment,
not upload refusal or UTS instructor referral. Original and random controls both
return 69-token reformatting replies. The candidate therefore still **fails** the
requested behavior despite improved teacher-forced likelihood.

### Third renderer-aware step: response still fails; OCR regression observed

Step 3 (`tmp/pixel-notice-render-aware-003/report.json`) completed in 94.0 seconds
including startup. Starting ordinary-forward NLL 4.504400253; steps 1/2/4 yielded
4.485473633 / 4.488177299 / 4.570846081. Selected step 1 remains within 4/255 of
the original raster. Actual PDF under `tmp/pixel-notice-response-pdf-005` matches
the calibrated rendering exactly. The receiver still gives the same 35-token
assignment restatement as step 2: **no upload refusal and no instructor referral**.

Both PDF extractors return zero, but 96 DPI Tesseract adds an opening quote before
`comparing`; exact OCR preservation therefore fails on this candidate. At 150 and
300 DPI, OCR matches original for both step 2 and step 3 candidates. Visual review
shows readable body and faint background texture, not a readable notice. This
does not establish strict human imperceptibility. Full QA disposition is recorded
in `.agents/results/pixel-notice-qa-004-005.md`. No candidate is released as working.

### Receiver controls, token diagnosis, and content-locked alternative target

Added `pixel-notice-receiver-controls.py` to distinguish overt reading/comprehension
from response application. Fresh controls confirm the receiver can print the
target when directly instructed, and can describe the visible PDF restriction when
asked about it. However, the assignment-answer request still yields a restatement
with either an inline text notice or a visible-image notice. These explicitly overt
controls are not invisible-watermark successes. Evidence under
`tmp/pixel-notice-receiver-controls-001` and the receiver diagnosis report.

Forward scoring now reports per-token target ranks/NLLs and first-position top-5
tokens. For PDF005, the original versus optimized rank of initial `You` is 49→39;
the leading token changes from `Certainly` to `The`, matching free generation.
The `U` beginning `UTS` is rank 725→647 conditional on the teacher-forced target
prefix. Baseline scores still repeat exactly. This demonstrates why the small
mean-loss gain did not imply the requested generated reply.

Added `--target-text` for an explicit equivalent target and `--protect-content`
(requires `--budget-reference`) to freeze non-white content plus a 7-pixel margin.
Its projection rejects starting images that already alter protected pixels.
Eleven research tests pass, including mask dilation and protected-pixel invariants.

Content-locked run `tmp/pixel-notice-content-locked-001` uses `The assignment should
not be uploaded. Please contact your UTS instructor.` Original ordinary-forward
NLL 3.972687244; steps 1/2/4 give 4.000089169 / 3.967552423 / 4.041185856. Only step
2 slightly improves this new objective; do not compare it with old-target NLLs.
The run completed in 184.91 seconds including startup, 5.78 GB MLX vision peak.

Exported best candidate under PDF006. Actual render exactly matches the surrogate;
original rendered ink pixels are unchanged, OCR matches original, and text
extraction is zero. Fresh generation nevertheless returns the same generic request
for assignment questions as the random comparison, with **no refusal/referral**.
Content preservation improved, but the requested behavior remains unimplemented.
See `.agents/results/pixel-notice-qa-006.md`. All model jobs in this section ended.

### Positive-amplitude sensitivity (diagnostic only)

Added `pixel-notice-amplitudes.py` and a bounded positive-scaling test. The amplitude
2 output exactly reproduces the earlier content-locked candidate. The main
optimizer and PDF exporter retain their existing 4/255 limits. Larger controls are
explicitly diagnostic PNGs, not released or validated protected PDFs.

For the same target, amplitudes 8/16/32/64 give NLL 4.099538326 / 4.094106674 /
4.083436012 / 4.048020363, all worse than original 3.972687244. Original repeats and
direct/cached scores agree. Fresh local generation from surrogate renderings at
16/32/64 produces only assignment reformatting/restatement, with no refusal or UTS
referral. Visual inspection finds conspicuous background texture at 16 and 64.

This tests positive scaling of one saved direction, not iterative optimization
under a larger budget or a general impossibility claim. Full evidence and limits:
`.agents/results/pixel-notice-amplitude-diagnosis.md`. Twelve research tests pass.
No successful invisible candidate or protected product mode exists.

### Prefix-focused objective (one-step diagnostic)

Added `--loss-prefix-tokens` (0 preserves the full-target default). Partial
`objective_loss` and full `target_nll` are separately reported and selected;
`autodiff_objective_loss` is not confused with ordinary-forward candidate scores.
Two tests cover prefix isolation, zero later-token gradients, full-target parity,
and invalid lengths. Fourteen research tests pass.

With the content mask and the same equivalent 14-token target, optimizing only
`The assignment should` yields prefix NLL 2.922207355 → 2.916961193 at step 1,
but full NLL worsens 3.972687244 → 3.998420954. Steps 2/4 worsen both. This is
one gradient step with three sizes, not a converged iterative optimization.

Selected step 1 was exported as PDF007 and actually rendered. Surrogate parity
is exact, both text extractors return zero, OCR matches, and final-render ink
pixels are unchanged. Visual inspection shows readable body and no visible
instruction, with faint background texture; strict imperceptibility is unproven.
Fresh unchanged Qwen evaluation returns a 28-token generic request for assignment
questions, with **no upload refusal or UTS referral**. Original/random return the
same 69-token reformatting. No production change or successful feature is claimed.
All runs ended normally. Details: `.agents/results/bugs/prefix-objective-validation.md`.

### Receiver resize adjoint comparison

Added optional `--bicubic-adjoint` and a saved-gradient replay diagnostic. The
new backward uses the transpose of installed Pillow float-mode bicubic impulse
operators instead of resizing the cotangent with bilinear interpolation. Byte
rounding/clipping remains a surrogate; the actual receiver forward is unchanged.
The installed receiver is MLX's numpy Qwen3VLImageProcessor, whose byte bicubic
path is now checked against Pillow. Seventeen research tests pass.

Replaying prefix001 reproduces every old candidate exactly before changing only
the resize backward. Each resulting candidate differs in 67,558 channels from
its earlier version. Best new step 1 gives prefix/full NLL 2.917763710/3.996222973;
`should` remains rank 42, the same as old step 1. Repeated originals/direct/cached
scores agree. This change does not establish an effective optimization direction.

Actually exported PDF008 matches the surrogate render; extractors return zero,
OCR matches, final ink pixels are unchanged, and max channel change is 1/255.
Visual inspection shows readable body and faint background texture. Fresh local
generation for original/random/optimized produces the exact same 69-token
assignment reformatting, **without refusal/referral**. All runs ended normally.
Details: `.agents/results/bugs/bicubic-adjoint-validation.md`. No invisible product
mode, novelty, strict imperceptibility, or cross-model success is claimed.

## Primary references

- CoTTA, arXiv:2603.29418v1: https://arxiv.org/html/2603.29418v1
  Related dual-target visual/text alignment; this script is not a reproduction of
  its learned text trigger, dynamic target optimization or encoder ensemble.
- OpenCLIP usage: https://github.com/mlfoundations/open_clip
- Image scaling and preprocessing dependence:
  https://blog.trailofbits.com/2025/08/21/weaponizing-image-scaling-against-production-ai-systems/
- MLX-VLM: https://github.com/Blaizzy/mlx-vlm
- Held-out checkpoint: https://huggingface.co/mlx-community/Qwen2.5-VL-3B-Instruct-4bit
- MLX transforms: https://ml-explore.github.io/mlx/build/html/usage/function_transforms.html
