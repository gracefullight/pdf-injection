# Novelty positioning — 30 September 2026

The strongest current contribution candidate is an empirical study of constrained,
text-free protective perturbations on rendered assessment documents, including
their failure conditions. A new effective protection algorithm has not yet been
demonstrated. This is a targeted comparison, not a systematic novelty search or
evidence of priority.

## Prior work that limits broad claims

| Primary source | What is already covered | Remaining distinction to investigate |
| --- | --- | --- |
| Shao et al., [ImageProtector, ACL 2026](https://aclanthology.org/2026.acl-long.72.pdf) | Bounded image perturbations that induce refusal, with visual quality constraints | Text-protected document regions, preserved document-reading functions, and actual PDF rendering conditions |
| Fan et al., [Who Can See Through You?](https://arxiv.org/abs/2512.18264), preprint first submitted December 2025 | Joint privacy suppression, non-private-question utility preservation, and visual consistency | Whether these objectives remain feasible under document-specific masks and rendering constraints; utility preservation itself is not new |
| Jang et al., [Doc-PP, Findings of ACL 2026](https://aclanthology.org/2026.findings-acl.832.pdf) | Policy-preserving multimodal document QA and a reasoning/verification intervention | Protection supplied by document pixels when the distributor cannot control the answering system's policy prompt or inference workflow |
| [DOPE: Decoy Oriented Perturbation Encapsulation](https://openreview.net/attachment?id=H6I7yJ0FVJ&name=pdf), anonymous submission manuscript | Assessment protection using semantic decoys and PDF/HTML render–parse differences | A text-free pixel channel with protected original text and separate rendering/behavior checks |

Source coverage: ImageProtector's formulation, Doc-PP's setup and system-prompt
templates, and DOPE's abstract/method description were inspected. The Fan et al.
arXiv metadata and abstract were checked; its full PDF was unavailable through the
browser tool. DOPE's acceptance status, release artifacts, and numerical claims
were not independently verified. Its manuscript is relevant prior art, not a
validated performance baseline for this project.

Doc-PP and Fan et al. were missing from the earlier close-reference table. Their
existence rules out presenting document policy compliance or joint protection
and utility as an unqualified first contribution. DOPE also means that the
educational application alone is insufficient differentiation.

## What our evidence currently supports

1. A concrete experimental setting combining frozen-model pixel optimization,
   an 8/255 budget, a protected text mask, actual PDF renderings, and separate task
   and layout-utility outcomes. These ingredients are not individually claimed
   as inventions, and their combination still needs comparison with close baselines.
2. A bounded negative result: EOT, utility-substituted EOT, and crossover selection
   did not produce strict refusal/referral on Specification3 despite accepted
   sampled-objective reductions and largely retained visual utility. One document
   and an unvalidated optimization derivative limit generalization and attribution.
3. A diagnostic distinction between failure to optimize reliably, failure to change
   generated behavior, and loss of behavior through rendering. Current diagnostics
   narrow possible explanations; they do not yet establish a new general mechanism.

EOT, crossover, FP64 arithmetic, finite differences, SAM, and Gumbel-Softmax are
not new methods by themselves. Referring a user to an instructor is a task-specific
target, not sufficient algorithmic novelty. The current four layout questions
also do not establish broad selective preservation of legitimate document QA.

## Meeting claim

> We investigate the feasibility and failure conditions of text-free protective
> perturbations on assessment documents under content-preservation and PDF-rendering
> constraints. Our current contribution is a controlled empirical investigation;
> a successful protection method and a general failure mechanism remain unproven.

The claim would become stronger with matched prior-method baselines, more
documents, richer paired allowed/restricted questions, and an identified cause
that predicts or remedies observed failure. Cross-model transfer is optional for
that contribution. Successful optimization is not mandatory for an empirical
paper, but a failure must yield reliable, generalizable information rather than
remain an unresolved implementation problem.
