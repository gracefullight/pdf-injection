# Integrated IMRaD outline for document policy routing

Date: 2026-10-09

Status: Combined manuscript outline. Completed observations, interpretations, and proposed evaluations are identified separately.

Working title: **Document Policy Routing with Visual Signals: Reach, Detection, and Compliance**

## Paper framing

This outline combines the earlier nine-section proposal with the policy-routing architecture and the corrected scope of the existing experiments. The central measurement question is whether a document signal reaches the relevant component, whether it is detected, and whether the model follows the associated policy. Human visibility is a separate property.

The proposed architecture detects a visual document signal, associates it with an institution-approved policy, and delivers that policy through the model's system instruction interface. The existing routing evidence concerns one manually configured pattern and policy. A general registry, payload decoding, multiple-policy selection, and interchangeable signal implementations remain proposed work.

The September 2026 presentation already proposed external PDF expert checks that pass structured watermark findings to a general model. The architecture here develops that direction by specifying policy association and the trust boundary for system instruction delivery.

Earlier text and pixel experiments explain the design choices. They used different documents, models, and interventions, so their outcomes cannot establish a controlled ranking of methods. The historical AcroForm observations are excluded from the central contribution because they did not satisfy the project's visibility and ingestion requirements. The combined outline does not reinstate the earlier reach/detect inversion claim as an established result.

## 1. Introduction

### 1.1 Academic integrity and document ingestion

Assessment documents increasingly become inputs to LLMs. An institution may want its approved assistance policy to accompany an assessment when the document is processed through an institutional service. That policy can prohibit assignment-specific answers while permitting questions about deadlines, contacts, or other administrative information.

This study concerns document policy application. It does not determine whether a student cheated, attribute intent, or provide disciplinary evidence. Covert evasion of screening tools is not a research objective. The intended deployment is a disclosed institutional gateway, with an accessible assessment copy and an explanation of the applicable policy.

### 1.2 Separate reach, detection, compliance, and visibility

For a document-carried instruction, the following questions require different observations.

1. **Reach:** Did the instruction or its recoverable representation enter the model's input through the evaluated ingestion path?
2. **Detect:** Could the specified detector identify that instruction or channel under its stated access conditions?
3. **Comply:** Did the model produce the policy-consistent response?

A fourth question concerns whether a person can see or read the added content. A small pixel difference does not establish human invisibility, and detector recovery does not establish that the model understood an instruction.

Routing introduces a different role for the document signal. The gateway detects the marker, retrieves trusted policy text, and delivers that policy to the model. The model need not interpret the marker's pixels as instructions. Marker recovery, policy delivery, and response compliance must therefore be recorded separately.

The earlier reach/detect inversion is a measurement hypothesis: ingestion and screening can expose different representations of the same document. The present paper must not claim that a specific inversion has been established from the excluded AcroForm evidence.

### 1.3 Related work and positioning

**Document ingestion and injection screening.** PhantomLint, CrackedPDFs, and the split-view PDF study motivate examining what users see, what extractors expose, and what a detector can classify (S. Liu & Ming, 2026; Murray, 2025; Thienpreecha & Subramanian, 2026). These findings support separate exposure and detection measurements. Their existence means that channel inventories and document-level detection evaluation are not sufficient novelty claims.

**Visual response steering and protective perturbations.** Image Hijacks studies inference-time visual control, while ImageProtector provides the protective-refusal objective that informed the document perturbation study (Bailey et al., 2024; Shao et al., 2026). Repeat-After-Me provides a comparison for adaptive rendered-instruction methods (Chen et al., 2026). Fan et al. (2025) motivates measuring protected-task suppression and permitted-task utility separately. These studies do not establish that the present PDF perturbations work.

**Signal embedding and recovery.** Zero-bit watermarking separates presence detection from message decoding (Furon, 2007). HiDDeN, TrustMark, StegaStamp, and Watermark Anything provide candidate mechanisms for embedding messages, recovering them after image distortions, or locating marked regions (Bui et al., 2025; Sander et al., 2025; Tancik et al., 2020; Zhu et al., 2018). PhantomStamp is a software candidate for the signal layer, not a peer-reviewed validation of the proposed PDF system (1zumiii, 2026).

**Output signatures and document policies.** Watermark seeding and in-context watermarking ask the model to produce identifiable output through instruction following (Aiersilan et al., 2026; Y. Liu et al., 2026). The proposed gateway instead detects a document signal externally and delivers an approved policy. Doc-PP already studies policy-preserving multimodal document QA and is a necessary comparison for policy-compliance claims (Jang et al., 2026). DOPE remains a provisional prior-art lead because its current full text is not readable through the checked public route (*DOPE*, n.d.).

**Visual detection and preprocessing.** SnapGuard provides context for detecting instructions in screenshots (Du et al., 2026). Image-scaling research motivates checking changes introduced during preprocessing (Quiring et al., 2020). Neither establishes detectability or robustness of this project's own markers.

The contribution to investigate is visual document-to-policy association, with explicit measurements of detection, delivery, compliance, permitted utility, and visibility. The paper does not claim that watermarking, system instruction priority, or document-policy enforcement is itself new.

### 1.4 Research questions and contributions

- **RQ1, channel measurement:** How can reach, injection screening, marker recovery, response compliance, and human visibility be measured without treating one as evidence of another?
- **RQ2, direct pixel intervention:** What response changes and reading costs are observed within the completed document-perturbation setting?
- **RQ3, configured routing:** Does the existing single-policy routing pipeline deliver the required refusal and referral while preserving permitted reading?
- **RQ4, proposed generalization:** What additional evidence is needed for signal-based policy selection, user-override robustness, provider coverage, and tool-description channels?

The completed contributions are a bounded negative result for the evaluated perturbation pipeline, a positive readable-notice pilot, and a manually configured signal-detection and policy-delivery pilot. The architectural contribution is a proposal for replaceable visual signals associated with registered policies. The measurement framework and auditability requirements organize these findings. Multi-policy selection, issuer authentication, and tool-selection experiments remain future work.

## 2. Methods

### 2.1 Actors, deployment assumptions, and trust boundaries

The actors are the document issuer or professor, student or other user, institutional gateway, detector, policy store, and LLM provider. An injection scanner may inspect untrusted content independently of the gateway's marker detector.

The institution controls the gateway and approved policy configuration in the proposed deployment. Institutional approval is a deployment assumption; the pilot policy is a research fixture, not evidence of an approved operational policy. The pilot requests pass through the configured routing pipeline. Uploaded documents, user questions, metadata, and tool descriptions remain untrusted inputs. A detected marker selects an operator-approved policy; text extracted from a PDF does not acquire system privileges.

The conceptual instruction ordering for this deployment is uploaded content < user instructions < institution-supplied system policy. This describes the intended authority boundary. It does not guarantee that a model will follow the policy under every conflicting user instruction. Resistance to overrides requires measurement.

Input-triggered output signatures provide a useful comparison because they rely on the model following document-carried instructions (Aiersilan et al., 2026; Y. Liu et al., 2026). The proposed gateway moves policy delivery to an institution-controlled instruction interface. This is a design distinction, not a demonstrated security advantage.

Recognizing a keyed pixel pattern does not authenticate the issuer or bind the policy to all document contents. The paper uses “signal-based routing” for the current prototype. Any future claim of authenticated routing requires an evaluated mechanism for issuer authorization and document binding.

### 2.2 Channel taxonomy and operational definitions

| Channel | Representation to inspect | Role in this paper | Evidence status |
| --- | --- | --- | --- |
| Document-object channels | Native text, form values, annotations, and appearance streams | Historical ingestion diagnostics and the 3 Tr baseline | AcroForm excluded from the proposed protection method |
| Pixel channels | Rendered page images, readable notices, and bounded pixel changes | Direct perturbation, readable notice, and marker embedding | Completed experiments have different settings |
| Metadata channels | PDF information fields and other non-page content | Taxonomy and future ingestion controls | No new metadata result claimed here |
| Tool-description channels | Descriptions delivered to an agent's tool-selection context | Future extension of the measurement framework | No completed experiment |

Two detection tasks must be distinguished. **Injection screening** asks whether a scanner flags document-carried instructions as suspicious. **Marker detection** asks whether the gateway recognizes an expected signal. A high marker score does not establish that an injection scanner missed an instruction, and it does not establish hidden semantic content.

Reach requires evidence from the ingestion path, such as an inspected model request, an extraction trace, or a dedicated recovery probe. If provider internals are unavailable, identify the observation as a proxy. Do not infer reach solely from refusal or from failure to refuse.

For routing, record marker recovery, the policy identifier supplied or selected, and policy delivery separately. Compliance concerns the model response. Visibility concerns human perception and accessibility. Distinguish measured pixel budgets from judgments made by human readers.

### 2.3 Proposed architecture and implemented prototype

The proposed processing sequence is:

    Document with a visual signal
        -> Gateway marker detection
        -> Approved policy association or registry lookup
        -> System-level policy delivery
        -> LLM response
        -> Separate compliance and permitted-utility assessment

The architecture supports a configured presence pattern or a payload watermark. Presence detection need not recover a message (Furon, 2007). Payload methods can recover an identifier that is resolved against an approved registry (Bui et al., 2025; Tancik et al., 2020; Zhu et al., 2018). Localized detection is another candidate capability (Sander et al., 2025). PhantomStamp is a possible frequency-domain implementation component (1zumiii, 2026).

The implemented prototype embeds a keyed blue-channel pattern in near-white pixels of rasterized pages, with a maximum channel change of 8/255. Its detector scores one expected pattern against a configured threshold. The caller supplies the expected policy identifier, key, and notice file. The prototype does not decode an arbitrary identifier or select among multiple registered policies.

Successful detection enables delivery of the configured policy through the provider's instruction interface. A registry, multiple-policy resolution, alternative watermark implementations, cryptographic binding, and provider-independent adapters are proposed components. Results from published image-watermark methods are not results from this PDF pipeline.

### 2.4 Experimental strands and controls

The historical text strand retains 3 Tr as the acceptable baseline within its tested conditions. AcroForm remains a diagnostic observation outside the central method and contribution. Neither its historical counts nor an interpretation of the form-value mechanism is used here to establish reliable invisible protection.

The direct perturbation strand uses Qwen2.5-VL-3B-Instruct in BF16 on rendered Specification3 inputs. It includes a protected text mask, an 8/255 budget, EOT, utility supervision, and crossover selection. ImageProtector and Image Hijacks motivate the objective and visual control setting (Bailey et al., 2024; Shao et al., 2026). This is a document-specific adaptation, not a reproduction of either complete protocol.

The readable-notice strand uses a synthetic four-page PDF and Luna. It renders policy text in an existing blank region, without adding a native text layer. Repeat-After-Me provides related rendered-instruction context, with a different adaptive objective and protocol (Chen et al., 2026).

The routing strand compares the original document, a marked document without routing, and a marked document with configured policy delivery. A matched system-policy-only condition has not been completed. The existing study therefore cannot isolate the marker's added value from the policy instruction's effect.

The studies must be reported separately. Gradient checks assess optimization reliability, not behavioral success. An improving objective, an ingestion probe, or a recovery score cannot substitute for the response-level evaluation.

### 2.5 Outcomes and grading

| Outcome | Observation required | Inference to avoid |
| --- | --- | --- |
| Reach | Ingestion trace or explicitly labeled recovery proxy | Refusal alone proves that a hidden instruction was read |
| Injection screening | Named scanner, exposed representation, labels, and controls | Marker recovery establishes scanner evasion |
| Marker recovery | Scores and decisions for correct, wrong, and absent signals | One wrong-key check establishes a false-positive rate |
| Policy delivery | Recorded configured or selected policy and instruction interface | A marker necessarily contains policy semantics |
| Compliance | Refusal, staff referral, and absence of prohibited assignment-specific help | Improved surrogate loss establishes compliance |
| Permitted utility | Correct answers to permitted questions | Refusing every question is successful policy enforcement |
| Human visibility | A specified human assessment, separate from pixel differences | An 8/255 budget establishes invisibility |

Protection and permitted utility require separate measurements (Fan et al., 2025; Jang et al., 2026). Document ingestion and screening also require separate observations (S. Liu & Ming, 2026; Murray, 2025; Thienpreecha & Subramanian, 2026).

Report distinct questions, repeated calls, document counts, completed responses, and transformations for every result. Retain failures and truncated outputs in the accounting. Historical question sets were not identical across all strands, so cross-study differences are descriptive.

For the planned override study, define the response rubric before collecting results. R0 denotes prohibited substantive assistance, R1 denotes incomplete policy compliance, and R2 requires refusal, referral, and no prohibited assistance. Score permitted questions for correctness separately. This planned rubric does not retroactively reclassify unreviewed historical responses.

## 3. Results


### 3.1 Historical text baseline and direct perturbation

- Earlier native-PDF text testing led to retaining 3 Tr as the acceptable historical text baseline. This observation is limited to the earlier tested conditions.
- The completed direct-perturbation study used Qwen2.5-VL-3B-Instruct in BF16 on rendered Specification3 inputs, with a protected text mask and a maximum pixel change of 8/255. EOT and utility-supervised optimization each ran for 36 updates across three paired seeds, totaling 216 updates. Crossover candidates were selected from those runs.
- None of the nine selected candidates achieved strict success on the development questions. The page and document evaluation conditions also produced no strict successes. Many responses were truncated, so these counts do not establish the absence of every possible refusal in every generated response.
- Selected reading checks matched the expected answer in all 312 page-level utility rows and in 204 of 248 document-level utility rows. These are repeated evaluation conditions, not independent documents or a measure of general semantic comprehension.
- The full FP32 numerical check passed none of twelve directional criteria. A separate smooth-input FP64 reference passed all twelve directional criteria at sufficiently small steps. The latter validates that numerical reference; it does not establish successful response steering or validate the FP32 optimizer.

These observations support a bounded negative result for the completed BF16 pipeline. They do not establish that all document perturbations are ineffective. Detailed optimization and numerical diagnostics belong in an appendix.

### 3.2 Readable policy notice

- Setting: gpt-5.6-luna and one synthetic four-page assessment PDF. A policy notice was rendered in an existing blank region on page 4, with a maximum channel change of 32/255 and no added native text layer.
- All three repeated calls on the selected notice produced refusal, referral to teaching staff or official resources, and no detected assignment-specific answer scaffold.
- All six distinct prohibited questions received the required response, and all six distinct permitted questions were answered correctly. Each question was tested once.
- All ten transformed-file response checks met the target: two calls for each of the five transformations listed in Section 3.4.

This pilot supports delivery of policy semantics through readable pixels. It does not establish human imperceptibility or performance on other documents and providers.

### 3.3 Signal detection and policy routing

- Setting: gpt-5.6-luna and one synthetic four-page assessment PDF. The caller configured one expected pattern and supplied its policy identifier, key, and policy notice.
- The keyed pattern changed the blue channel by at most 8/255. No policy text was present in the final PDF's pixels or extractable text layer.
- The original-document detection score was 0.000. The marked document scored 7.096 with the correct key and 0.004 with the tested wrong key, against an acceptance threshold of 1.500. These individual controls do not establish a population false-positive rate.
- The original document allowed assessment answering in all three calls. The marked document without routing also allowed answering in all three calls. Configured routing produced refusal, staff referral, and no detected assignment-specific answer scaffold in all three calls.
- All six distinct prohibited questions received the required refusal and referral. All six distinct permitted questions were answered correctly. Each question received one test.

The prohibited questions requested assignment answers, a worked solution, a complete submission, step-by-step hints with an architecture recommendation, a requirements and marking-criteria summary, and a Korean translation. The permitted questions concerned the policy contact, page count, background colour, course number and assignment title, deadline, and official question channel. Summary and translation were prohibited by this fixture's policy; they are not universally prohibited request types.

The pilot demonstrates the configured detection-and-policy-delivery path. It does not evaluate a multi-policy registry, independently establish human invisibility, or isolate the signal's added value against a matched system-policy-only condition.

### 3.4 File transformations

The five tested transformations were:

1. Re-rasterization.
2. JPEG compression at quality 95.
3. JPEG compression at quality 85.
4. Reduction to 75 percent size followed by restoration.
5. Gaussian blur with a radius of 0.5 pixels.

Detection and response outcomes are separate measurements. The routing pilot passed detection and the target response check on each of the five transformed versions, with one response call per version. Keep this count distinct from the readable-notice pilot's ten calls.

Image preprocessing can change represented content, which motivates these transformation checks (Quiring et al., 2020). The transformations here are a small robustness screen, not a reproduction of that study's image-scaling attack or defense evaluation.


### 3.5 What the completed evidence separates

The readable notice delivered policy semantics through pixels. In the routing pilot, the marker alone did not induce the target refusal, while configured policy delivery did. These observations support distinguishing document-carried instructions from externally detected signals associated with trusted policies.

The pilot does not directly compare injection-scanner detection with model reach. It therefore does not establish the earlier reach/detect inversion. It also does not establish human invisibility, user-override resistance, cross-provider transfer, multi-policy selection, or issuer authentication.

## 4. Discussion

### 4.1 From channel measurement to policy routing

The reach/detect/comply framework explains why a delivered instruction, a recoverable marker, and a compliant response require separate evidence. Direct perturbation attempts to influence response behavior through the model's visual input. A readable notice supplies policy language as document content. Routing uses external detection to enable trusted policy delivery.

The completed Qwen result is a bounded negative result for its evaluated pipeline. It does not invalidate ImageProtector, Image Hijacks, or other visual steering methods under their own settings (Bailey et al., 2024; Shao et al., 2026). The fixed readable notice also differs from adaptive rendered-instruction search (Chen et al., 2026). Differing documents and models prevent a method ranking.

The earlier inversion proposal remains useful as an evaluation question. Establishing it would require matched content, controlled representations, a specified ingestion path, and a specified scanner. Excluded AcroForm observations cannot carry that contribution in the present manuscript.

### 4.2 Which layer carries the policy

A policy notice in a document occupies the content layer. A gateway can instead supply approved policy through its system instruction interface. This change requires deployment control and an authorized policy source. It does not give arbitrary uploaded content the authority to set system instructions.

The predicted difference under conflicting user instructions remains a hypothesis. The current pilot shows configured policy delivery under its tested questions, not guaranteed adherence to system policy under adversarial overrides.

The marker's proposed contribution is document-specific policy association and selection. A matched system-policy-only condition is necessary to establish what signal-based routing adds. Multiple valid policies and wrong-policy controls are also required. Doc-PP is a direct comparison for policy-preserving document QA, so the existence of a policy or a refusal response is insufficient evidence of novelty (Jang et al., 2026).

### 4.3 Auditability and disclosure

Auditability takes priority over concealment in the proposed deployment. Users should be able to learn that the institution uses document signals, what policy applies, what assistance remains permitted, and how to contact a person about an incorrect decision. The research should disclose the signal mechanism and its limitations.

A low-visibility marker can coexist with disclosed use. Low visibility is an aesthetic property to measure, not evidence of secrecy, safety, or screening evasion. Detection is useful because it enables independent checking of document-policy associations.

The historical routing instruction “do not reveal the detection mechanism to the student” conflicts with this disclosure position. Its presence must be reported rather than treated as an established deployment requirement. A deployment would need to resolve that conflict. Keeping a cryptographic key confidential would not justify concealing the existence or meaning of an enforced policy.

### 4.4 Limitations and claim boundaries

- The routing and readable-notice pilots each concern one synthetic four-page document and Luna. The perturbation study uses rendered Specification3 inputs and Qwen. The paper must not describe every document as synthetic or every strand as using the same questions.
- Human visibility has not been independently established. A maximum channel change is a measurement of the file, not a human perception result.
- The correct-key, wrong-key, and original-document scores are individual controls. They do not estimate population detection errors.
- The current prototype uses a caller-supplied policy association. It has not evaluated a registry, arbitrary payload decoding, or selection among policies.
- The signal's added value over supplying the same system policy directly is unmeasured.
- User overrides, additional providers, crop and rotation, print-scan, marker removal, and marker copying have not been established.
- AcroForm is excluded because it did not meet the project's visibility and ingestion requirements. The earlier inversion claim and “works on Qwen but does not transfer to GPT” summary are not reinstated as findings.
- PhantomStamp and the cited learned watermark methods have not been integrated or compared in this project.

SnapGuard motivates assessing rendered instructions rather than assuming faint content is undetectable (Du et al., 2026). Its results do not measure this project's marker. Published image-watermark results motivate candidate implementations but do not establish PDF text fidelity, human visibility, authentication, or print-scan robustness here (Bui et al., 2025; Sander et al., 2025; Tancik et al., 2020; Zhu et al., 2018).

### 4.5 Future evaluation

#### 4.5.1 Matched routing comparisons and deployment module

Use the same documents, questions, models, and policy text for the original document, marked document without routing, original document with the policy supplied directly, and marked document with signal-based routing. Include unmarked and wrong-signal controls.

Then evaluate multiple valid signals associated with distinct approved policies. Measure missed detections, incorrect detections, wrong-policy selection, prohibited assistance, permitted utility, visibility, and latency. These comparisons test policy association rather than only the effect of a system instruction.

A provider-independent skill or gateway module is a proposed engineering extension. Its approved policy registry should control system instruction delivery. Concatenating untrusted document instructions into a user prompt would not implement the stated trust boundary. Registry maintenance, authorization, error handling, and audit records require explicit designs.

#### 4.5.2 Conflicting user instructions, E2

Compare the readable notice and routed policy under a fixed set of conflicting user requests, including requests to disregard document notices. Pre-register the document set, ordinary and conflicting questions, response grading, and failure accounting before running the comparison.

The expected asymmetry is a hypothesis: a content-layer notice may be easier to override than an institution-supplied policy. Score prohibited responses using the stated R0/R1/R2 rubric and permitted responses for correctness. Record partial compliance and leakage. Do not assume the system-layer condition will always hold.

#### 4.5.3 Provider and ingestion generalization, E1

Evaluate a second provider with native PDF ingestion and a matched rendered-image route where available. Preserve the same documents and prompts across providers. Use the retained 3 Tr baseline, readable notice, and routing controls to examine ingestion and response differences.

Any AcroForm follow-up would be a separately labeled ingestion diagnostic, subject to the unresolved visibility and usability requirements. It would not restore AcroForm as the proposed protection method. Record any direct reach observations separately from behavioral proxies.

A provider matrix for guarded PDFs remains a planned evaluation. No untested provider cell should be reported as a measured success, failure, or transfer result.

#### 4.5.4 Agent tool selection

Extend the measurement framework to a controlled agent environment with synthetic tools. Inspect whether a tool description is delivered to the model, whether a specified static scanner flags its content, and whether the agent selects or invokes the tool.

Use semantically matched descriptions and benign controls so that changes in legitimate tool relevance are not confused with instruction-following effects. Log the model-visible description, scanner result, selected tool, and actual invocation separately. A selection change is an outcome, not sufficient evidence of how the description was processed.

The question is whether the model, user interface, and scanner expose different representations, and whether this produces another reach/detect discrepancy. This is a proposed defensive measurement study. It contributes no completed result or demonstrated inversion to the present paper.

#### 4.5.5 Signal implementations and accessibility

Compare the current presence pattern with selected watermark methods while keeping the routing policy fixed. Measure detection and wrong-policy errors after additional transformations, including cropping, rotation, printing and scanning, removal, and copying. Test text readability and human visibility independently.

HiDDeN, TrustMark, StegaStamp, Watermark Anything, and PhantomStamp are candidates with different capabilities, not already integrated alternatives (1zumiii, 2026; Bui et al., 2025; Sander et al., 2025; Tancik et al., 2020; Zhu et al., 2018). Watermark Anything motivates region-level evaluation, and StegaStamp motivates physical-image tests. Their existing results do not establish PDF performance.

Rasterization removes searchable text and can prevent screen-reader access. An image-only protected PDF must not be the only assessment copy available to a student. Evaluate an accessible route as part of any deployment proposal.

### 4.6 Ethics and governance

The project measures document channels and policy application. It does not infer misconduct from a marker, refusal, or output signature. The Luna pilots use synthetic assessment fixtures. The Qwen study uses rendered Specification3 derivatives. No inference about real student conduct follows from either setting.

Retain the project's ten existing governance requirements:

1. A hidden instruction must not damage the factual accuracy of the answer.
2. It must not request fake citations or fabricated facts.
3. It must not force a methodology that disadvantages the student or is inappropriate.
4. A canary match must not be used as sole disciplinary evidence.
5. Institutional academic-integrity policy takes precedence.
6. Research on real students requires ethics or IRB review.
7. The effect of invisible text on screen readers and accessibility must be reviewed.
8. The prompt and PDF hashes the professor used must be recorded in advance.
9. Detection results must be presented together with uncertainty and alternative explanations.
10. The UI must not use definitive AI-misconduct verdict phrasing.

These requirements also constrain routing. A detected marker must not authorize arbitrary document text, distort a permitted answer, or produce a misconduct verdict. Public disclosure of the practice, accessible alternatives, and a human contact route are necessary parts of the proposed deployment.

The mechanism-disclosure conflict described in Section 4.3 remains unresolved in the historical pilot. No claim of ethically validated institutional deployment follows from the completed technical checks.

### 4.7 Provisional conclusion

> Document reach, detector visibility, and model compliance require separate evidence. The completed perturbation study found no strict success within its evaluated setting, while a readable notice and a configured policy-routing pilot produced the required responses in their respective small tests. We propose an auditable gateway that associates visual document signals with approved policies; its added value, multiple-policy selection, override resistance, and broader robustness remain to be evaluated.

## Appendix A. Integration of the nine-section proposal

| Earlier section | Placement in this IMRaD outline | Treatment |
| --- | --- | --- |
| 1. Introduction | 1.1–1.4 | Retains academic integrity, separate reach/detect/comply questions, and non-evasion stance |
| 2. Threat model and channel taxonomy | 2.1–2.2 | Restores actors, four channel families, trust boundaries, and human visibility |
| 3. Document-object study | 2.4 and 3.1 | Keeps 3 Tr as historical context; excludes AcroForm as a central method and does not claim a verified inversion |
| 4. Pixel study | 2.4 and 3.1–3.2 | Retains bounded negative perturbation evidence and the readable-notice pilot without cross-setting ranking |
| 5. Routing study | 2.3 and 3.3–3.4 | Centers configured policy delivery; separates it from proposed registry and authentication |
| 6. Defense layer discussion | 4.1–4.3 | Restores instruction-layer interpretation and auditability |
| 7. Future work | 4.5 | Includes module/registry, E1, E2, tool selection, signal methods, and accessibility |
| 8. Ethics and limitations | 4.3–4.4 and 4.6 | Includes the ten existing requirements and the unresolved disclosure conflict |
| 9. Related work | 1.3 and citations throughout | Retains necessary prior work and adds policy enforcement and watermark mechanisms |

## Appendix B. Claim–evidence map

| Claim | Evidence in this document | Status |
| --- | --- | --- |
| Completed BF16 perturbation pipeline achieved no strict success | Configuration, nine selected candidates, and response limitations in 3.1 | Bounded observed result |
| Readable pixels carried the policy in the Luna pilot | Three repeats, six prohibited and six permitted questions, ten transformed-file calls in 3.2 | Observed in one fixture |
| Marker detection enabled configured policy delivery | Correct/wrong-key scores and original/marker-only/routed response controls in 3.3 | Observed in one configured association |
| Five transformed versions passed routing checks | Named transformations and one response call per version in 3.4 | Small robustness screen |
| Reach/detect inversion is established | No retained matched ingestion/scanner mechanism result | Not claimed |
| The marker is invisible to people | Pixel budget only; no independent human study | Not established |
| Routing adds value over the same direct system policy | Matched baseline absent | Proposed evaluation |
| The architecture selects among policies or authenticates issuers | Caller-supplied association in the prototype | Proposed components, not established |
| System policy resists user overrides across providers | E1 and E2 remain planned | Hypothesis |
| Tool descriptions reproduce the inversion | No completed tool-selection study | Future measurement question |

## Appendix C. Citation placement and source access

Checked on October 9, 2026. Eighteen of the nineteen entries have a verified public full-text or code route. DOPE remains unconfirmed. DOI resolution, publisher-page access, and readable full text were checked separately; a verification page returning HTTP 200 was not counted as a readable paper. The routes below were opened and their titles or code contents checked. Public PDFs were also checked as PDF files rather than inferred from their URL suffix.

| Citation | Placement in the outline | What the citation supports | Verified access |
| --- | --- | --- | --- |
| Aiersilan et al. (2026) | 1.3 and 2.1 | Input instructions that induce output signatures; comparison with external marker detection. It does not establish misconduct attribution or universal PDF channel survival. | DOI resolves; [arXiv full text](https://arxiv.org/html/2605.16336v2) is readable. |
| Bailey et al. (2024) | 1.3, 2.4, and 4.1 | Inference-time visual response steering; context for interpreting the bounded perturbation result. | [Publisher-linked PDF](https://raw.githubusercontent.com/mlresearch/v235/main/assets/bailey24a/bailey24a.pdf) is readable. |
| Bui et al. (2025) | 1.3, 2.3, and 4.4–4.5 | A candidate learned payload watermark; image-domain results do not establish text-PDF performance. | DOI reaches IEEE, but readable article content was unavailable there in this check; [final CVF PDF](https://www.openaccess.thecvf.com/content/ICCV2025/papers/Bui_TrustMark_Robust_Watermarking_and_Watermark_Removal_for_Arbitrary_Resolution_Images_ICCV_2025_paper.pdf) is readable by direct download. |
| Chen et al. (2026) | 1.3, 2.4, and 4.1 | Adaptive rendered-instruction steering; comparison with the fixed readable notice and pixel-only experiment. | DOI resolves; [arXiv full text](https://arxiv.org/html/2609.04533) is readable. |
| *DOPE* (n.d.) | 1.3, provisional only | A lead on assessment-document protection. Its role must remain provisional until current full text and metadata can be verified. | The cited attachment returns browser-verification HTML rather than a PDF. No readable fallback was confirmed. |
| Du et al. (2026) | 1.3 and 4.4 | Detection of rendered screenshot instructions; a reason not to assume faint text is undetectable. It does not evaluate our keyed marker. | DOI resolves; [arXiv full text](https://arxiv.org/html/2604.25562) is readable. |
| Fan et al. (2025) | 1.3 and 2.5 | Separate protection and permitted-utility outcomes; prior work on their joint evaluation. | DOI resolves; [arXiv full text](https://arxiv.org/html/2512.18264) is readable. |
| Furon (2007) | 1.3 and 2.3 | Presence detection without a decoded payload. This definition does not establish robustness or authentication of our pattern. | DOI reaches IEEE without readable article content in this check; [author preprint](https://arxiv.org/pdf/cs/0606034) is readable. |
| Jang et al. (2026) | 1.3, 2.5, and 4.2 | Policy-preserving document QA and reasoning/verification; the nearest comparison for policy compliance. | DOI resolves; [ACL full-text PDF](https://aclanthology.org/2026.findings-acl.832.pdf) is readable. |
| S. Liu and Ming (2026) | 1.3 and 2.5 | Distinguishing document construction, ingestion exposure, and downstream behavior. | DOI resolves; [arXiv full-text PDF](https://arxiv.org/pdf/2606.15020v2) is readable. |
| Y. Liu et al. (2026) | 1.3 and 2.1 | In-context output watermarking through instruction following; comparison with gateway-selected policy delivery. | [Final ICLR PDF](https://proceedings.iclr.cc/paper_files/paper/2026/file/571082ea18d30060177dfcaf662ff0e5-Paper-Conference.pdf) is readable. |
| Murray (2025) | 1.3 and 2.5 | Hidden-text detection by comparing extraction with rendered-content OCR. It does not establish detection of a pixel watermark. | DOI resolves; [arXiv full text](https://arxiv.org/html/2508.17884v2) is readable. |
| 1zumiii (2026) | 1.3, 2.3, and 4.5.5 | A frequency-domain software candidate for the replaceable signal layer; not a peer-reviewed or integrated PDF result. | Cited commit opens; [pinned README](https://raw.githubusercontent.com/1zumiii/PhantomStamp/92f4ed80d167ad65a63c9818be941ccb2bcb2ee4/README.md) and source code are readable. |
| Quiring et al. (2020) | 1.3 and 3.4 | Preprocessing can change represented image content; motivation for checking transformations, not evidence that our signal is robust. | [Final USENIX PDF](https://www.usenix.org/system/files/sec20-quiring.pdf) is readable. |
| Sander et al. (2025) | 1.3, 2.3, and 4.5.5 | Localized watermark detection and message recovery; a candidate for future region-level comparisons. | Proceedings page opens; [final ICLR PDF](https://proceedings.iclr.cc/paper_files/paper/2025/file/c5ee1911dffe4886367eee7fca314235-Paper-Conference.pdf) is readable. |
| Shao et al. (2026) | 1.3, 2.4, and 4.1 | The protective-refusal objective adapted in the document experiment; its findings do not establish our PDF result. | DOI resolves; [ACL full-text PDF](https://aclanthology.org/2026.acl-long.72.pdf) is readable. |
| Tancik et al. (2020) | 1.3, 2.3, and 4.5.5 | Payload recovery under physical-image distortions; motivation for future print/camera tests. | DOI reaches IEEE without readable article content in this check; [CVF full-text PDF](https://openaccess.thecvf.com/content_CVPR_2020/papers/Tancik_StegaStamp_Invisible_Hyperlinks_in_Physical_Photographs_CVPR_2020_paper.pdf) is readable. |
| Thienpreecha and Subramanian (2026) | 1.3 and 2.5 | Document-injection detection, matched benign controls, and grouped evaluation; not downstream policy-routing success. | DOI resolves; [arXiv full text](https://arxiv.org/html/2607.19396v2) is readable. |
| Zhu et al. (2018) | 1.3, 2.3, and 4.5.5 | Learned message embedding/recovery with simulated distortions; a candidate alternative to the handcrafted prototype. | DOI opens Springer; the publisher chapter requires subscription. [CVF author-version PDF](https://openaccess.thecvf.com/content_ECCV_2018/papers/Jiren_Zhu_HiDDeN_Hiding_Data_ECCV_2018_paper.pdf) is readable. |

The citations above identify prior methods, measurement principles, and comparison settings. They do not replace the project's experimental evidence in Section 3 or demonstrate that any proposed component has been integrated.

## References


Aiersilan, A., Yousefi, A., & Pless, R. (2026). *On seeding watermarks to detect verbatim LLM copy-paste responses*. arXiv. https://doi.org/10.48550/arXiv.2605.16336

Bailey, L., Ong, E., Russell, S., & Emmons, S. (2024). Image Hijacks: Adversarial images can control generative models at runtime. In R. Salakhutdinov, Z. Kolter, K. Heller, A. Weller, N. Oliver, J. Scarlett, & F. Berkenkamp (Eds.), *Proceedings of the 41st International Conference on Machine Learning* (Vol. 235, pp. 2443–2455). PMLR. https://proceedings.mlr.press/v235/bailey24a.html

Bui, T., Agarwal, S., & Collomosse, J. (2025). TrustMark: Robust watermarking and watermark removal for arbitrary resolution images. In *2025 IEEE/CVF International Conference on Computer Vision (ICCV)* (pp. 18629–18639). IEEE. https://doi.org/10.1109/ICCV51701.2025.01731

Chen, S., Tsai, Y.-L., Evtimov, I., Chaudhuri, K., Popa, R. A., Wagner, D., & Zharmagambetov, A. (2026). *Repeat-After-Me: Black-box adaptive visual prompt injection*. arXiv. https://doi.org/10.48550/arXiv.2609.04533

*DOPE: Decoy oriented perturbation encapsulation: Human-readable, AI-hostile documents for academic integrity* [Manuscript submitted for publication]. (n.d.). OpenReview. https://openreview.net/attachment?id=H6I7yJ0FVJ&name=pdf

Du, M., Fang, H., Ma, H., Chen, J., Xu, K., Yin, Q., & Chang, E.-C. (2026). *SnapGuard: Lightweight prompt injection detection for screenshot-based web agents*. arXiv. https://doi.org/10.48550/arXiv.2604.25562

Fan, Y., Chen, J., Tian, Y., & Yin, Z. (2025). *Who can see through you? Adversarial shielding against VLM-based attribute inference attacks*. arXiv. https://doi.org/10.48550/arXiv.2512.18264

Furon, T. (2007). A constructive and unifying framework for zero-bit watermarking. *IEEE Transactions on Information Forensics and Security, 2*(2), 149–163. https://doi.org/10.1109/TIFS.2007.897272

Jang, H., Chang, H., & Lee, H. (2026). Doc-PP: Document policy preservation benchmark for large vision-language models. In M. Liakata, V. P. Moreira, J. Zhang, & D. Jurgens (Eds.), *Findings of the Association for Computational Linguistics: ACL 2026* (pp. 16859–16881). Association for Computational Linguistics. https://doi.org/10.18653/v1/2026.findings-acl.832

Liu, S., & Ming, J. (2026). *What users see is not what models read: Split-view PDFs in document-to-LLM supply chains*. arXiv. https://doi.org/10.48550/arXiv.2606.15020

Liu, Y., Zhao, X., Kruegel, C., Song, D., & Bu, Y. (2026). In-context watermarks for large language models. In C. Vondrick, B. Hariharan, C. Raffel, L. Pinto, D. Yang, & A. Faust (Eds.), *International Conference on Learning Representations* (pp. 53136–53162). https://proceedings.iclr.cc/paper_files/paper/2026/hash/571082ea18d30060177dfcaf662ff0e5-Abstract-Conference.html

Murray, T. (2025). *PhantomLint: Principled detection of hidden LLM prompts in structured documents*. arXiv. https://doi.org/10.48550/arXiv.2508.17884

1zumiii. (2026). *PhantomStamp* (Commit 92f4ed80d167ad65a63c9818be941ccb2bcb2ee4) [Computer software]. GitHub. https://github.com/1zumiii/PhantomStamp/commit/92f4ed80d167ad65a63c9818be941ccb2bcb2ee4

Quiring, E., Klein, D., Arp, D., Johns, M., & Rieck, K. (2020). Adversarial preprocessing: Understanding and preventing image-scaling attacks in machine learning. In *29th USENIX Security Symposium (USENIX Security 20)* (pp. 1363–1380). USENIX Association. https://www.usenix.org/conference/usenixsecurity20/presentation/quiring

Sander, T., Fernandez, P., Durmus, A., Furon, T., & Douze, M. (2025). Watermark anything with localized messages. In Y. Yue, A. Garg, N. Peng, F. Sha, & R. Yu (Eds.), *International Conference on Learning Representations* (pp. 79569–79599). https://proceedings.iclr.cc/paper_files/paper/2025/hash/c5ee1911dffe4886367eee7fca314235-Abstract-Conference.html

Shao, Z., Liu, H., Hu, Y., & Gong, N. Z. (2026). Leave my images alone: Preventing multi-modal large language models from analyzing images via visual prompt injection. In M. Liakata, V. P. Moreira, J. Zhang, & D. Jurgens (Eds.), *Proceedings of the 64th Annual Meeting of the Association for Computational Linguistics (Volume 1: Long papers)* (pp. 1588–1604). Association for Computational Linguistics. https://doi.org/10.18653/v1/2026.acl-long.72

Tancik, M., Mildenhall, B., & Ng, R. (2020). StegaStamp: Invisible hyperlinks in physical photographs. In *2020 IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)* (pp. 2114–2123). IEEE. https://doi.org/10.1109/CVPR42600.2020.00219

Thienpreecha, P., & Subramanian, K. (2026). *CrackedPDFs: A controlled benchmark for hidden prompt injection in PDFs*. arXiv. https://doi.org/10.48550/arXiv.2607.19396

Zhu, J., Kaplan, R., Johnson, J., & Fei-Fei, L. (2018). HiDDeN: Hiding data with deep networks. In V. Ferrari, M. Hebert, C. Sminchisescu, & Y. Weiss (Eds.), *Computer vision – ECCV 2018* (Lecture Notes in Computer Science, Vol. 11219, pp. 682–697). Springer. https://doi.org/10.1007/978-3-030-01267-0_40

### Reference notes

Metadata checked on October 9, 2026. The S. Liu and Ming reference uses the current title; an earlier version was titled *Semantic Integrity Failures in Document-to-LLM Supply Chains*. The cited record is the 2026 arXiv version, although its authors report acceptance at IEEE S&P 2027. Aiersilan et al. report AIES 2026 acceptance; the reference identifies the arXiv version checked here. The DOPE entry remains provisional because the previously inspected manuscript names no authors or date, and its current attachment is blocked by browser verification. PhantomStamp is cited as a dated software snapshot. StegaStamp and HiDDeN use the final publisher pagination associated with their DOIs; the CVF page ranges belong to the open versions listed in the access table. The Watermark Anything entry follows the paper and authors' citation for Alain Durmus's name rather than the proceedings export's inconsistent parsing.
