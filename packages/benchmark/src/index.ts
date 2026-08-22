/**
 * @pdf-injection/benchmark — Phase 3 provider benchmark (PRD §21 / API
 * contract .agents/results/api-contracts/pdf-injection-phase3-5-api.md §2).
 *
 * Provider adapters (anthropic / openai / mock) share the `ProviderAdapter`
 * interface (`providers/types.ts`); `runMatrix()` drives the full
 * provider x condition x repeat matrix and produces `ModelTestResult[]` +
 * aggregates + the research smoke-test gate
 * (`@pdf-injection/detector`'s `smokeTestGate`); `toJson`/`toCsv` implement
 * the export endpoint's two formats; `config.ts` validates the
 * `research/experiment-configs/*.json` file shape.
 */
export * from "./config";
export * from "./disclosure";
export * from "./export";
export * from "./matrix";
export * from "./prng";
export * from "./providers";
export * from "./refusal";
