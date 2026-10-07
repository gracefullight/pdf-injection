# AcroForm disposition and retained 3 Tr baseline

Recorded: 2026-10-07. This note records the researcher's clarification of earlier
experiments. It is not a new model evaluation.

## Operational finding

| Earlier text-channel condition | Researcher-reported observation | Disposition |
| --- | --- | --- |
| AcroForm with a displayed field value | The instruction was visible near the bottom of the PDF. | Exclude: fails the visual requirement. |
| AcroForm variant intended to keep the field invisible | The LLM did not read or reflect the instruction in its response. | Exclude: did not meet the effectiveness requirement in that configuration. |
| Page-content text using rendering mode 3 (`3 Tr`) | The researcher confirmed this was the only acceptable earlier text-channel approach. | Retain as the historical native-PDF text baseline. |

The hidden AcroForm observation is recorded as a researcher-reported outcome.
The exact PDF bytes, viewer configuration, annotation flags, response archive,
and repeat count for that follow-up were not identified during this update.
Do not assign it an invented success rate or assume it used the current code's
`NoView` configuration. `/V` denotes a field value; it is not an invisibility flag.

## Relationship to the earlier canary results

The [2026-08-23 probe](../2026-08-23-round3-probe-modes/README.md) recorded:

- `acroform_field`: injected canaries matched in 5/5 responses;
- `value_only`: injected canaries matched in 3/3 responses;
- `appearance_only`: injected canaries matched in 0/3 responses;
- `render_mode_3` and `white_text`: injected canaries matched in 5/5 responses each.

These counts remain historical observations for their exact artifacts. They do
not validate the later visually hidden AcroForm variant, establish human
invisibility, or measure refusal and instructor referral. The researcher's
selection of `3 Tr` reflects suitability for the intended use, not a uniquely
highest canary-match rate.

The earlier value-only/scanner contrast must not be cited as proof of a usable
invisible protection method. The extrapolated value-only 5/5 claim in the old
report exceeded its measured 3/3 result and has been removed.

## Implementation context

The [AcroForm injector](../../../packages/pdf-engine/src/inject-acroform-field.ts)
stores the instruction in `/V` and supplies a `3 Tr` appearance stream. Its
comments describe viewers displaying `/V` despite the invisible appearance. The
current implementation sets `NoView` (32) and reduces the widget rectangle to
1 by 1 point. These implementation choices and structural tests do not establish
viewer-independent invisibility or successful model responses.

## Consequence for the paper and slides

- Present AcroForm as an excluded preliminary approach, with the two failure
  conditions above. Keep its historical probe results in background or an
  appendix rather than presenting it as an adopted invisible method.
- Remove the AcroForm reach/detect inversion from the proposed main contribution
  list. Any discussion of the historical canary/scanner contrast must retain its
  artifact-specific scope and the visibility qualification.
- Retain `3 Tr` as the acceptable earlier text-channel baseline. It uses native
  PDF text objects and is distinct from subsequent raster-only experiments.
- Keep pixel perturbations, the readable raster stamp, and watermark-based
  system-policy routing separate. Routing success does not establish successful
  perturbation-based protection.
