import type {
  BenchmarkCondition,
  ExpectedSignal,
  ModelTestAggregate,
  ModelTestResult,
  ProviderName,
  SmokeTestGate,
} from "@pdf-injection/contracts";
import {
  smokeTestGate as computeSmokeTestGate,
  matchSignalsAsync,
  type SmokeTestAggregate,
} from "@pdf-injection/detector";
import { sha256Hex } from "@pdf-injection/validation";
import { detectDisclosure } from "./disclosure";
import { createProvider } from "./providers/factory";
import type { ProviderAdapter } from "./providers/types";
import { detectRefusalHeuristic } from "./refusal";

/** Per-condition PDF bytes for the matrix run (produced by the caller — apps/api's Model Test phase — from the job's stored source/injected artifacts). */
export interface MatrixConditionInput {
  condition: BenchmarkCondition;
  pdfBytes: Uint8Array;
  pdfSha256: string;
}

export interface MatrixProviderInput {
  name: ProviderName;
  model?: string;
}

export interface RunMatrixInput {
  providers: MatrixProviderInput[];
  conditions: MatrixConditionInput[];
  repeats: number;
  outerPrompt: string;
  signals: ExpectedSignal[];
  /** The instruction actually injected into the non-"original" condition PDFs; used for disclosure detection and by the `mock` adapter. Pass `""` if unknown (disables disclosure detection and mock instruction-following). */
  hiddenInstruction: string;
  /** 0-based page index the instruction targets. Defaults to 0. Forwarded to the `mock` adapter only. */
  targetPageIndex?: number;
  /** Bounded parallelism for provider calls. Defaults to 2 (PS_MODEL_TEST_CONCURRENCY default, contract §0.2). */
  concurrency?: number;
  onProgress?: (progress: { done: number; total: number }) => void;
  /** When aborted, no new calls are started; already-in-flight calls are allowed to finish. Results/aggregates only cover completed calls. */
  signal?: AbortSignal;
  /** Defaults to `process.env`; forwarded to `createProvider` for anthropic/openai credential + model resolution. */
  env?: Record<string, string | undefined>;
}

export interface RunMatrixResult {
  results: ModelTestResult[];
  aggregates: ModelTestAggregate[];
  smokeTestGate: SmokeTestGate;
  interpretation: string;
}

interface Task {
  provider: ProviderAdapter;
  providerName: ProviderName;
  condition: MatrixConditionInput;
  repeat: number;
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  signal?: AbortSignal,
): Promise<T[]> {
  const results: T[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      if (signal?.aborted) return;
      const i = nextIndex++;
      if (i >= tasks.length) return;
      const task = tasks[i];
      if (!task) return;
      const result = await task();
      results.push(result);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, tasks.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function buildInterpretation(gate: SmokeTestGate): string {
  const base =
    "This report is a deterministic string-matching benchmark of provider responses against pre-defined expected signals across " +
    'the "original" and injected PDF conditions. A match indicates the response text contains evidence consistent with the ' +
    'injected instruction; it is not proof that any model "read", "obeyed", or was otherwise influenced by that instruction, and ' +
    "the absence of a match is not proof of the opposite. Results should be reviewed by a human before drawing conclusions; this " +
    "report does not confirm or rule out any individual's use of AI.";

  if (gate.best === null) {
    return `${base} No provider/condition pair produced a comparable delta against the original condition in this run.`;
  }

  return (
    `${base} The largest observed delta in this run was ${gate.best.deltaPp.toFixed(1)} percentage points ` +
    `(${gate.best.provider}, ${gate.best.condition} vs. original), ${gate.passed ? "at or above" : "below"} the ${gate.threshold}pp smoke-test threshold.`
  );
}

function rate(count: number, n: number): number {
  return n > 0 ? count / n : 0;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Runs the full provider x condition x repeat matrix (contract §2), builds
 * per-(provider,condition) aggregates, and evaluates the research
 * smoke-test gate (`@pdf-injection/detector`'s `smokeTestGate`).
 *
 * Provider adapters are constructed once per distinct `providers` entry
 * (not once per call) — `mock` gets `hiddenInstruction` / `signals` baked
 * in via `MockContext` so it can decide, per PDF, whether the instruction
 * is actually present (see `providers/mock.ts`'s module doc).
 */
export async function runMatrix(input: RunMatrixInput): Promise<RunMatrixResult> {
  const concurrency = input.concurrency ?? 2;
  const outerPromptSha256 = sha256Hex(input.outerPrompt);

  const adapters = new Map<ProviderName, ProviderAdapter>();
  for (const p of input.providers) {
    adapters.set(
      p.name,
      createProvider({
        name: p.name,
        model: p.model,
        env: input.env,
        mockContext:
          p.name === "mock"
            ? {
                hiddenInstruction: input.hiddenInstruction,
                targetPageIndex: input.targetPageIndex,
                expectedSignals: input.signals,
              }
            : undefined,
      }),
    );
  }

  const tasks: Task[] = [];
  for (const p of input.providers) {
    const adapter = adapters.get(p.name);
    if (!adapter) continue;
    for (const condition of input.conditions) {
      for (let repeat = 1; repeat <= input.repeats; repeat++) {
        tasks.push({ provider: adapter, providerName: p.name, condition, repeat });
      }
    }
  }

  const total = tasks.length;
  let done = 0;

  const callables = tasks.map((task) => async (): Promise<ModelTestResult> => {
    const executedAt = new Date().toISOString();
    let answer: Awaited<ReturnType<ProviderAdapter["askWithPdf"]>>;
    try {
      answer = await task.provider.askWithPdf({
        pdfBytes: task.condition.pdfBytes,
        prompt: input.outerPrompt,
      });
    } catch (err) {
      answer = {
        text: "",
        stopReason: null,
        refusal: false,
        usage: { inputTokens: null, outputTokens: null },
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const signalReport = await matchSignalsAsync(input.signals, answer.text);
    const allSignalsMatched =
      signalReport.total === 0 ? true : signalReport.matchedCount === signalReport.total;
    const anySignalMatched = signalReport.matchedCount > 0;
    const disclosure = detectDisclosure(input.hiddenInstruction, answer.text);
    const refusal = answer.refusal || detectRefusalHeuristic(answer.text);

    const result: ModelTestResult = {
      provider: task.providerName,
      modelId: task.provider.model,
      condition: task.condition.condition,
      repeat: task.repeat,
      executedAt,
      outerPromptSha256,
      pdfSha256: task.condition.pdfSha256,
      rawResponse: answer.text,
      responseSha256: sha256Hex(answer.text),
      signalMatches: signalReport.results,
      allSignalsMatched,
      anySignalMatched,
      disclosure,
      refusal,
      latencyMs: answer.latencyMs,
      usage: answer.usage,
      error: answer.error ?? null,
    };

    done++;
    input.onProgress?.({ done, total });
    return result;
  });

  const results = await runWithConcurrency(callables, concurrency, input.signal);

  // --- aggregates -----------------------------------------------------
  // Nested Map<provider, Map<condition, rows>> instead of a joined-string key
  // + split() round-trip -- avoids relying on ProviderName/BenchmarkCondition
  // values never containing the join separator.
  const groups = new Map<ProviderName, Map<BenchmarkCondition, ModelTestResult[]>>();
  function getGroup(provider: ProviderName, condition: BenchmarkCondition): ModelTestResult[] {
    let byCondition = groups.get(provider);
    if (!byCondition) {
      byCondition = new Map();
      groups.set(provider, byCondition);
    }
    let rows = byCondition.get(condition);
    if (!rows) {
      rows = [];
      byCondition.set(condition, rows);
    }
    return rows;
  }

  for (const r of results) {
    getGroup(r.provider, r.condition).push(r);
  }

  interface GroupEntry {
    provider: ProviderName;
    condition: BenchmarkCondition;
    rows: ModelTestResult[];
  }
  const groupEntries: GroupEntry[] = [];
  for (const [provider, byCondition] of groups) {
    for (const [condition, rows] of byCondition) {
      groupEntries.push({ provider, condition, rows });
    }
  }

  const originalAllSignalsRateByProvider = new Map<ProviderName, number>();
  for (const { provider, condition, rows } of groupEntries) {
    if (condition !== "original") continue;
    originalAllSignalsRateByProvider.set(
      provider,
      rate(rows.filter((r) => r.allSignalsMatched).length, rows.length),
    );
  }

  const aggregates: ModelTestAggregate[] = [];
  for (const { provider, condition, rows } of groupEntries) {
    const n = rows.length;
    const allSignalsRate = rate(rows.filter((r) => r.allSignalsMatched).length, n);
    const anySignalRate = rate(rows.filter((r) => r.anySignalMatched).length, n);
    const disclosureRate = rate(rows.filter((r) => r.disclosure).length, n);
    const refusalRate = rate(rows.filter((r) => r.refusal).length, n);
    const meanLatencyMs = average(rows.map((r) => r.latencyMs));

    const originalRate = originalAllSignalsRateByProvider.get(provider);
    const deltaVsOriginalPp =
      condition === "original" || originalRate === undefined
        ? null
        : (allSignalsRate - originalRate) * 100;

    aggregates.push({
      provider,
      condition,
      n,
      allSignalsRate,
      anySignalRate,
      disclosureRate,
      refusalRate,
      meanLatencyMs,
      deltaVsOriginalPp,
    });
  }

  // --- smoke-test gate (per-repeat rates only meaningful when repeats > 1) ---
  const smokeAggregates: SmokeTestAggregate[] = groupEntries.map(
    ({ provider, condition, rows }) => {
      const agg = aggregates.find((a) => a.provider === provider && a.condition === condition);
      const perRepeatRates =
        input.repeats > 1 ? rows.map((r) => (r.allSignalsMatched ? 1 : 0)) : undefined;
      return {
        provider,
        condition,
        n: rows.length,
        allSignalsRate: agg?.allSignalsRate ?? 0,
        disclosureRate: agg?.disclosureRate ?? 0,
        refusalRate: agg?.refusalRate ?? 0,
        perRepeatRates,
      };
    },
  );

  // detector's SmokeTestGateResult widens provider/condition to `string` (it's
  // string-agnostic on purpose); every value we feed it comes from our own
  // ProviderName/BenchmarkCondition-typed aggregates above, so narrowing back
  // to contracts' SmokeTestGate here is safe by construction.
  const gate = computeSmokeTestGate(smokeAggregates) as SmokeTestGate;
  const interpretation = buildInterpretation(gate);

  return { results, aggregates, smokeTestGate: gate, interpretation };
}
