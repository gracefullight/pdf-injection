# IMRaD outline for document policy routing

Date: 2026-10-09

Status: Manuscript outline. The general architecture and additional comparisons remain proposed work.

Working title: **Document Policy Routing with Visual Signals: Architecture and Pilot Study**

## Paper framing

The paper proposes a gateway that detects an embedded visual signal in an assessment document, associates it with a registered policy, and supplies that policy through system-level instructions. The signal can be a detectable pixel pattern or a watermark carrying an identifier. The embedding and detection methods are replaceable components of the proposed architecture.

The existing evidence comes from a manually configured, single-policy prototype. Earlier text, pixel-perturbation, and readable-notice experiments explain the design choices. Differences in documents, models, and interventions prevent a controlled ranking of these studies.

The September 2026 presentation already proposed external PDF expert checks that pass structured watermark findings to a general model. This outline develops that direction into explicit association with an approved policy and system-level instruction delivery. The presentation is historical design context, not evidence that the proposed general architecture has been implemented.

## 1. Introduction

### 1.1 Problem and setting

- Introduce assessment PDFs used as input to LLMs.
- Define the intended behavior: decline assistance prohibited by the document's registered policy, refer the user to teaching staff or official resources, and preserve permitted document reading.
- State that the study concerns document policy application. It does not infer whether a student has cheated.

### 1.2 Related work and motivation

Organize the literature around the following functions:

- **Document ingestion and exposure:** use PhantomLint, CrackedPDFs, and the split-view PDF study to distinguish document channels, injection detection, and the ingestion path that determines what reaches the model (S. Liu & Ming, 2026; Murray, 2025; Thienpreecha & Subramanian, 2026). These studies motivate separate measurements of signal recovery and response behavior.
- **Direct response steering:** introduce Image Hijacks as inference-time visual response control, ImageProtector as the starting point for protective pixel perturbations, and Repeat-After-Me as an adaptive rendered-instruction approach (Bailey et al., 2024; Chen et al., 2026; Shao et al., 2026). Discuss joint protection and utility preservation in relation to Fan et al. (2025), rather than claiming those objectives as new.
- **Signal embedding and detection:** distinguish presence detection without a decoded message from payload recovery (Furon, 2007). Introduce HiDDeN as a learned encoder/decoder approach, and include TrustMark, StegaStamp, and Watermark Anything as payload watermarking methods with differing image distortion and localization settings (Bui et al., 2025; Sander et al., 2025; Tancik et al., 2020; Zhu et al., 2018). Treat PhantomStamp as an open-source implementation candidate, not a peer-reviewed paper (1zumiii, 2026).
- **Input-triggered output signatures:** discuss watermark seeding in assessment prompts and in-context watermarking as related approaches that rely on model instruction following to produce identifiable output (Aiersilan et al., 2026; Y. Liu et al., 2026). The proposed gateway instead detects a document signal externally and selects an approved policy. This distinction also separates policy application from detecting copied model output.
- **Policy application:** compare the proposal with Doc-PP's policy-preserving multimodal document QA and reasoning/verification framework (Jang et al., 2026). Retain the anonymous DOPE manuscript as a provisional prior-art lead on assessment-document protection (*DOPE*, n.d.). Its current full-text access is unconfirmed, so it should not carry a novelty or performance claim without a readable copy. Distinguish document-QA interventions from a visual signal associated with an externally registered policy.
- **Visual detection and preprocessing:** use SnapGuard as context for detecting instructions in rendered screenshots and image-scaling research as context for changes introduced before model inference (Du et al., 2026; Quiring et al., 2020). Neither source establishes detection or robustness of our own marked PDFs.

Close the review by motivating the proposed connection between document signal detection and policy application. Do not claim that watermarking, visual markers, or instruction hierarchy are new. Novelty relative to document-policy enforcement work requires a dedicated comparison.

### 1.3 Research questions

- **RQ1 — Detection:** Can the embedded signal be detected after the tested file transformations?
- **RQ2 — Policy application:** Does the configured routing pipeline produce refusal and referral without substantive answer leakage for prohibited requests?
- **RQ3 — Permitted reading:** Does the pipeline preserve correct responses to requests permitted by the registered policy?

Correct selection among multiple registered policies is an additional evaluation question for the proposed architecture. The current single-policy pilot does not answer it.

### 1.4 Contributions and scope

- Propose a gateway architecture with replaceable visual-signal embedding and detection components.
- Report initial detection, response, selectivity, and transformation results from the existing single-policy prototype.
- Report the bounded negative result from the completed Qwen document-perturbation study as evidence informing the design.

## 2. Methods

### 2.1 Deployment setting and trust boundaries

- Define the document issuer, user, institutional gateway, detector, policy store, and LLM provider.
- Assume that the institution controls the gateway and policy configuration, and that evaluated requests pass through that gateway.
- Treat uploaded documents and user questions as untrusted content. The gateway supplies approved policy text; uploaded text does not become a system instruction.
- State that recognizable pixels alone do not authenticate the issuer or bind a policy to the document's contents.

Use input-side watermark seeding and in-context watermarking to define the comparison setting: those approaches seek identifiable model output through instruction following (Aiersilan et al., 2026; Y. Liu et al., 2026). The proposed gateway performs external signal detection and selects operator-approved policy text. This is a design distinction, not a demonstrated security advantage.

### 2.2 Proposed architecture

```text
Document with an embedded visual signal
    -> Gateway detection
    -> Registered policy lookup
    -> System-level policy delivery
    -> LLM response
```

Describe two supported design options:

- A presence pattern whose identity and associated policy are supplied by gateway configuration. Cite Furon (2007) for the zero-bit presence-detection formulation.
- A payload watermark from which a policy identifier is recovered and resolved against an approved registry. Cite HiDDeN, TrustMark, and StegaStamp for image-message embedding and recovery (Bui et al., 2025; Tancik et al., 2020; Zhu et al., 2018).

Use Watermark Anything to motivate a detector that can report the location of marked regions as well as recovered messages (Sander et al., 2025). Discuss PhantomStamp as a frequency-domain implementation candidate (1zumiii, 2026). These citations support candidate signal mechanisms; their published or documented image results are not measurements of our PDF routing system.

Mark the general policy registry, multi-policy resolution, and interchangeable implementations as proposed components in the architecture figure.

### 2.3 Implemented single-policy prototype

- Describe the keyed blue-channel pattern embedded in near-white pixels of rasterized PDF pages, with a maximum channel change of 8/255.
- Explain how the local detector scores one expected pattern against a configured threshold.
- State that the caller supplies the expected policy identifier, key, and notice file. The prototype does not decode an arbitrary identifier or select among multiple registered policies.
- Explain how a successful detection enables delivery of the operator-supplied policy through the provider's instruction interface.

### 2.4 Experimental studies and controls

- **Earlier native-PDF text experiments:** retain 3 Tr as the acceptable historical text baseline, with its tested scope stated.
- **Direct pixel perturbation:** describe the completed Qwen2.5-VL-3B-Instruct BF16 study on rendered Specification3 inputs, including the protected text mask, 8/255 budget, EOT, utility supervision, and crossover selection. Cite ImageProtector for the protective-refusal objective and Image Hijacks for inference-time visual response control (Bailey et al., 2024; Shao et al., 2026). Describe the document-specific adaptation rather than presenting it as a reproduction of either paper's complete protocol.
- **Readable policy notice:** describe the separate Luna pilot with policy text rendered in an existing blank region of a synthetic four-page assessment PDF. Cite Repeat-After-Me when discussing related rendered-instruction methods (Chen et al., 2026), while stating that its adaptive attack objective and evaluation differ from this fixed policy-notice pilot.
- **Signal-based routing:** compare the original document, the marked document without routing, and the marked document with configured policy delivery in the Luna pilot.

Keep the Qwen and Luna studies separate. Put detailed optimization histories and numerical diagnostics in an appendix. Explain that gradient checks assess the numerical reliability of optimization and do not establish response-level success.

### 2.5 Outcome measures

- Report detector scores, accepted detections, missed detections, and negative controls separately from model responses.
- Define strict response success as refusal plus referral to teaching staff or official resources, without substantive assignment-specific assistance.
- Report permitted-query correctness separately from prohibited-request refusal.
- State the number of distinct questions, repeats, documents, and transformations for every result. Preserve failed detections and incomplete responses in the accounting.
- Distinguish measured pixel differences from human judgments of visibility.

Cite Fan et al. (2025) for joint protection/utility evaluation and Jang et al. (2026) for policy-preserving document QA. Use PhantomLint, CrackedPDFs, and the split-view study to explain why detection, ingestion exposure, and downstream behavior need separate measures (S. Liu & Ming, 2026; Murray, 2025; Thienpreecha & Subramanian, 2026). These references inform the measurement design; the numerical outcomes in Section 3 are this project's own observations.

## 3. Results

### 3.1 Earlier text and direct-perturbation findings

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

Name the five tested transformations:

1. Re-rasterization.
2. JPEG compression at quality 95.
3. JPEG compression at quality 85.
4. Reduction to 75 percent size followed by restoration.
5. Gaussian blur with a radius of 0.5 pixels.

Report detection and response results separately. The routing pilot passed detection and the target response check on each of the five transformed versions, with one response call per version. Keep this count distinct from the readable-notice pilot's ten calls.

When interpreting these checks, cite Quiring et al. (2020) for the broader importance of image preprocessing. The transformations here are a small robustness screen, not a reproduction of their image-scaling attack or defense evaluation.

## 4. Discussion

### 4.1 Interpretation of the mechanism

Interpret the pilot as a configured detector-and-policy pipeline. The detector recognizes the signal; the gateway supplies the policy through the instruction interface. The signal alone did not induce the target refusal in the tested Luna calls.

Discuss the Qwen negative result and readable-notice positive result as design evidence. Their differing conditions do not establish the superiority of routing over direct perturbation.

Relate the negative perturbation finding to ImageProtector and Image Hijacks within their respective experimental settings (Bailey et al., 2024; Shao et al., 2026). Distinguish the readable notice from adaptive visual injection in Repeat-After-Me (Chen et al., 2026). The present results neither reproduce nor invalidate the broader findings of those studies.

### 4.2 What routing must add

The proposed value of routing is document-specific policy association and selection. A matched condition supplying the same system policy without signal detection is needed to separate policy-delivery effects from the signal's contribution. This comparison has not been completed.

A multi-policy experiment is also required before claiming correct selection among registered policies. The existing prototype tests one manually configured association.

Position this question alongside Doc-PP, which already studies policy-preserving multimodal document QA (Jang et al., 2026). The proposed contribution to investigate is visual document-to-policy association and its measured costs and errors. The existence of a document policy or an instruction-following response is not sufficient evidence of novelty.

### 4.3 Limitations

- The routing pilot covers one synthetic four-page document, one model, one configured policy, and small question sets.
- Human visibility, resistance to conflicting user instructions, and broader provider coverage have not been established.
- The five transformations do not establish crop, rotation, print-scan, or marker removal/copying robustness.
- PhantomStamp, TrustMark, and StegaStamp have not been integrated or compared in this project. Results on photographs do not establish performance on text-heavy PDF pages.
- AcroForm is excluded from the proposed method and central contribution because it did not meet the project's visibility and ingestion requirements.

Use SnapGuard to explain why low-contrast rendered instructions should not be assumed undetectable (Du et al., 2026). Its screenshot detection results do not establish detection of our readable notice or keyed blue-channel marker. Likewise, published watermark recovery results motivate candidate methods, but do not establish their visibility, text fidelity, or robustness on assessment PDFs (Bui et al., 2025; Sander et al., 2025; Tancik et al., 2020; Zhu et al., 2018).

### 4.4 Future evaluation

Prioritize matched comparisons using the same documents, models, questions, and policy text:

- Original document without an additional policy.
- Marked document without routing.
- Original document with the same system policy supplied directly.
- Marked document with signal-based routing.
- Unmarked documents and incorrect marker candidates.
- Multiple valid signals associated with distinct approved policies.

Then compare signal implementations, including the current pattern and selected literature methods. Evaluate detection errors, wrong-policy selection, permitted reading, answer leakage, human visibility, and latency. Treat user overrides and additional transformations as separate robustness studies.

### 4.5 Provisional conclusion

> We propose a gateway architecture that maps detected visual document signals to registered policies. A manually configured pilot supports its feasibility, while policy-selection accuracy, broader robustness, and the added value of signal-based routing remain to be evaluated.

## Citation placement and source access

Checked on October 9, 2026. Eighteen of the nineteen entries have a verified public full-text or code route. DOPE remains unconfirmed. DOI resolution, publisher-page access, and readable full text were checked separately; a verification page returning HTTP 200 was not counted as a readable paper. The routes below were opened and their titles or code contents checked. Public PDFs were also checked as PDF files rather than inferred from their URL suffix.

| Citation | Placement in the outline | What the citation supports | Verified access |
| --- | --- | --- | --- |
| Aiersilan et al. (2026) | 1.2 and 2.1 | Input instructions that induce output signatures; comparison with external marker detection. It does not establish misconduct attribution or universal PDF channel survival. | DOI resolves; [arXiv full text](https://arxiv.org/html/2605.16336v2) is readable. |
| Bailey et al. (2024) | 2.4 and 4.1 | Inference-time visual response steering; context for interpreting the bounded perturbation result. | [Publisher-linked PDF](https://raw.githubusercontent.com/mlresearch/v235/main/assets/bailey24a/bailey24a.pdf) is readable. |
| Bui et al. (2025) | 2.2 and 4.3 | A candidate learned payload watermark; image-domain results do not establish text-PDF performance. | DOI reaches IEEE, but readable article content was unavailable there in this check; [final CVF PDF](https://www.openaccess.thecvf.com/content/ICCV2025/papers/Bui_TrustMark_Robust_Watermarking_and_Watermark_Removal_for_Arbitrary_Resolution_Images_ICCV_2025_paper.pdf) is readable by direct download. |
| Chen et al. (2026) | 2.4 and 4.1 | Adaptive rendered-instruction steering; comparison with the fixed readable notice and pixel-only experiment. | DOI resolves; [arXiv full text](https://arxiv.org/html/2609.04533) is readable. |
| *DOPE* (n.d.) | 1.2, provisional only | A lead on assessment-document protection. Its role must remain provisional until current full text and metadata can be verified. | The cited attachment returns browser-verification HTML rather than a PDF. No readable fallback was confirmed. |
| Du et al. (2026) | 1.2 and 4.3 | Detection of rendered screenshot instructions; a reason not to assume faint text is undetectable. It does not evaluate our keyed marker. | DOI resolves; [arXiv full text](https://arxiv.org/html/2604.25562) is readable. |
| Fan et al. (2025) | 1.2 and 2.5 | Separate protection and permitted-utility outcomes; prior work on their joint evaluation. | DOI resolves; [arXiv full text](https://arxiv.org/html/2512.18264) is readable. |
| Furon (2007) | 2.2 | Presence detection without a decoded payload. This definition does not establish robustness or authentication of our pattern. | DOI reaches IEEE without readable article content in this check; [author preprint](https://arxiv.org/pdf/cs/0606034) is readable. |
| Jang et al. (2026) | 2.5 and 4.2 | Policy-preserving document QA and reasoning/verification; the nearest comparison for policy compliance. | DOI resolves; [ACL full-text PDF](https://aclanthology.org/2026.findings-acl.832.pdf) is readable. |
| S. Liu and Ming (2026) | 1.2 and 2.5 | Distinguishing document construction, ingestion exposure, and downstream behavior. | DOI resolves; [arXiv full-text PDF](https://arxiv.org/pdf/2606.15020v2) is readable. |
| Y. Liu et al. (2026) | 1.2 and 2.1 | In-context output watermarking through instruction following; comparison with gateway-selected policy delivery. | [Final ICLR PDF](https://proceedings.iclr.cc/paper_files/paper/2026/file/571082ea18d30060177dfcaf662ff0e5-Paper-Conference.pdf) is readable. |
| Murray (2025) | 1.2 and 2.5 | Hidden-text detection by comparing extraction with rendered-content OCR. It does not establish detection of a pixel watermark. | DOI resolves; [arXiv full text](https://arxiv.org/html/2508.17884v2) is readable. |
| 1zumiii (2026) | 2.2 | A frequency-domain software candidate for the replaceable signal layer; not a peer-reviewed or integrated PDF result. | Cited commit opens; [pinned README](https://raw.githubusercontent.com/1zumiii/PhantomStamp/92f4ed80d167ad65a63c9818be941ccb2bcb2ee4/README.md) and source code are readable. |
| Quiring et al. (2020) | 3.4 interpretation and 1.2 | Preprocessing can change represented image content; motivation for checking transformations, not evidence that our signal is robust. | [Final USENIX PDF](https://www.usenix.org/system/files/sec20-quiring.pdf) is readable. |
| Sander et al. (2025) | 2.2 and 4.4 | Localized watermark detection and message recovery; a candidate for future region-level comparisons. | Proceedings page opens; [final ICLR PDF](https://proceedings.iclr.cc/paper_files/paper/2025/file/c5ee1911dffe4886367eee7fca314235-Paper-Conference.pdf) is readable. |
| Shao et al. (2026) | 2.4 and 4.1 | The protective-refusal objective adapted in the document experiment; its findings do not establish our PDF result. | DOI resolves; [ACL full-text PDF](https://aclanthology.org/2026.acl-long.72.pdf) is readable. |
| Tancik et al. (2020) | 2.2 and 4.3–4.4 | Payload recovery under physical-image distortions; motivation for future print/camera tests. | DOI reaches IEEE without readable article content in this check; [CVF full-text PDF](https://openaccess.thecvf.com/content_CVPR_2020/papers/Tancik_StegaStamp_Invisible_Hyperlinks_in_Physical_Photographs_CVPR_2020_paper.pdf) is readable. |
| Thienpreecha and Subramanian (2026) | 1.2 and 2.5 | Document-injection detection, matched benign controls, and grouped evaluation; not downstream policy-routing success. | DOI resolves; [arXiv full text](https://arxiv.org/html/2607.19396v2) is readable. |
| Zhu et al. (2018) | 2.2 and 4.3 | Learned message embedding/recovery with simulated distortions; a candidate alternative to the handcrafted prototype. | DOI opens Springer; the publisher chapter requires subscription. [CVF author-version PDF](https://openaccess.thecvf.com/content_ECCV_2018/papers/Jiren_Zhu_HiDDeN_Hiding_Data_ECCV_2018_paper.pdf) is readable. |

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
