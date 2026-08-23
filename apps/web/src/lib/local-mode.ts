import { useQuery } from "@tanstack/react-query";
import { getHealth } from "@/lib/api";

/**
 * Local (server-free) mode.
 *
 * The injection engine is pure `pdf-lib`, and validation (render, pixel diff,
 * text extraction) already runs in the browser, so authoring a PDF needs no
 * backend at all. When the API is unreachable — e.g. the GitHub Pages
 * deployment, which serves only static files — the app switches to running
 * everything on-device instead of failing at "Generate".
 *
 * Resolution order:
 *   1. `?local=1` / `?local=0` in the URL — explicit override, for testing
 *      either path against any deployment.
 *   2. Automatic: `GET /health` failed, so there is no usable API.
 *
 * The flag is read synchronously by `api.ts` (which has no React context), so
 * it lives in a module-level variable that `useLocalMode()` keeps in sync.
 */

let localModeEnabled = readOverride() === true;

function readOverride(): boolean | undefined {
  if (typeof window === "undefined") return undefined;
  const value = new URLSearchParams(window.location.search).get("local");
  if (value === null) return undefined;
  return value !== "0" && value !== "false";
}

/** Read by `api.ts` at call time — never cached by callers. */
export function isLocalModeEnabled(): boolean {
  return localModeEnabled;
}

/** Exported for `useLocalMode()` and tests; not part of the public app surface. */
export function setLocalModeEnabled(enabled: boolean): void {
  localModeEnabled = enabled;
}

/** Pure resolution rule, unit-tested without React or a network. */
export function resolveLocalMode(input: {
  override: boolean | undefined;
  healthFailed: boolean;
}): boolean {
  return input.override ?? input.healthFailed;
}

export interface LocalModeState {
  /** Whether jobs are generated on-device. */
  enabled: boolean;
  /** True while the health probe is still deciding (nothing has been claimed yet). */
  isResolving: boolean;
  /** True when local mode is on because the API is unreachable (not an explicit override). */
  becauseApiUnreachable: boolean;
}

export function useLocalMode(): LocalModeState {
  const override = readOverride();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    staleTime: 60_000,
    retry: 1,
    // An explicit override makes the probe irrelevant for the decision.
    enabled: override === undefined,
  });

  const healthFailed = health.isError;
  const enabled = resolveLocalMode({ override, healthFailed });
  setLocalModeEnabled(enabled);

  return {
    enabled,
    isResolving: override === undefined && health.isLoading,
    becauseApiUnreachable: override === undefined && healthFailed,
  };
}
