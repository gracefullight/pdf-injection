/**
 * Module worker entry point for `regexMatchWithTimeout` (see
 * `regex-match-timeout.ts`). Runs a single `regexMatch()` call on a
 * dedicated thread so a pathological pattern's catastrophic backtracking
 * can be forcibly aborted by `worker.terminate()` from the caller, which a
 * same-thread `setTimeout` cannot do against synchronous JS.
 *
 * This is the one file in `packages/detector` that is NOT plain
 * synchronous library code — it is loaded via
 * `new Worker(new URL("./regex-worker.ts", import.meta.url), { type: "module" })`
 * and runs under both Bun's Worker implementation and browser/Vite module
 * workers.
 *
 * `self` is typed locally (not via the `webworker` lib) to avoid
 * conflicting with this package's `DOM` lib (used by
 * `regex-match-timeout.ts` for the `Worker`/`MessageEvent` types on the
 * main-thread side); the shape below is the minimal subset this file uses.
 */
import { type RegexMatchResult, regexMatch } from "./regex-match";

export interface RegexWorkerRequest {
  pattern: string;
  flags: string;
  text: string;
}

declare const self: {
  onmessage: ((event: { data: RegexWorkerRequest }) => void) | null;
  postMessage: (message: RegexMatchResult) => void;
};

self.onmessage = (event) => {
  const { pattern, flags, text } = event.data;
  const result = regexMatch(pattern, flags, text);
  self.postMessage(result);
};
