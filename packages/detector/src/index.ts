/**
 * @pdf-injection/detector — deterministic evidence matchers and Phase 4
 * research statistics for PDF-native hidden-instruction PoC work (PRD
 * §12.1, §21.5, §26 Phase 4).
 *
 * IMPORTANT, applies to EVERY export in this package: none of this is an
 * "AI detected" / "cheating detected" verdict, and none should ever be
 * added. Every function here reports deterministic match evidence,
 * evidence-based scores, or statistical comparisons against a baseline —
 * outputs a human reviewer can inspect, never a standalone conclusion
 * about how a piece of text was produced. See each module's JSDoc
 * (especially `match-signals.ts`, `scoring.ts`, `calibration.ts`,
 * `statistics.ts`, `smoke-test-gate.ts`) for the specific caveats, and PRD
 * §23.3 for the list of claims this project explicitly does not make.
 */
export * from "./calibration";
export * from "./exact-match";
export * from "./match-signals";
export * from "./methodology-match";
export * from "./ordered-terms";
export * from "./regex-match";
export * from "./regex-match-timeout";
export * from "./scoring";
export * from "./section-order";
export * from "./smoke-test-gate";
export * from "./statistics";
