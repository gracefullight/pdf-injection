import type { HealthResponse } from "@pdf-injection/contracts";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getHealth } from "@/lib/api";

/** `health.features.ollama` — API contract addendum §6 (Ollama local provider). */
export type OllamaFeature = HealthResponse["features"]["ollama"];

/** Flattened view of `GET /api/v1/health`'s `features` object plus top-level `qpdfAvailable`. */
export interface Features {
  externalProviders: boolean;
  researchMode: boolean;
  ocrAvailable: boolean;
  canvasAvailable: boolean;
  koPayload: boolean;
  zhPayload: boolean;
  qpdfAvailable: boolean;
  ollama: OllamaFeature;
}

const FALLBACK_OLLAMA_FEATURE: OllamaFeature = {
  available: false,
  baseUrl: "http://localhost:11434",
  models: [],
};

/** Conservative defaults while health hasn't loaded yet (or the request failed) — every gated feature stays off. */
export const FALLBACK_FEATURES: Features = {
  externalProviders: false,
  researchMode: false,
  ocrAvailable: false,
  canvasAvailable: false,
  koPayload: false,
  zhPayload: false,
  qpdfAvailable: false,
  ollama: FALLBACK_OLLAMA_FEATURE,
};

/** Pure — testable without mocking TanStack Query. */
export function deriveFeatures(health: HealthResponse | undefined): Features {
  if (!health) return FALLBACK_FEATURES;
  const { features } = health;
  return {
    externalProviders: features.externalProviders,
    researchMode: features.researchMode,
    ocrAvailable: features.ocrAvailable,
    canvasAvailable: features.canvasAvailable,
    koPayload: features.koPayload,
    zhPayload: features.zhPayload,
    qpdfAvailable: health.qpdfAvailable,
    // Defensive fallback against a stale/older API server not yet redeployed with this field,
    // even though `HealthResponse` now types it as required.
    ollama: features.ollama ?? FALLBACK_OLLAMA_FEATURE,
  };
}

export function useFeatures(): { features: Features; isLoading: boolean; isError: boolean } {
  const query = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    staleTime: 60_000,
    retry: 1,
  });
  return {
    features: deriveFeatures(query.data),
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

export type FeatureKey = keyof Features;

/** The exact env var a professor/operator would set to enable each server-gated feature. */
export const FEATURE_ENV_VAR: Partial<Record<FeatureKey, string>> = {
  externalProviders: "PDFI_ALLOW_EXTERNAL_PROVIDERS",
  researchMode: "PDFI_RESEARCH_MODE",
  koPayload: "PDFI_FONT_DIR",
  zhPayload: "PDFI_FONT_DIR",
};

/** ocrAvailable / canvasAvailable / qpdfAvailable are native-dependency capabilities, not env toggles. */
export const FEATURE_CAPABILITY_REASON: Partial<Record<FeatureKey, string>> = {
  ocrAvailable:
    "OCR (tesseract.js) is not available on this server. A native dependency is missing.",
  canvasAvailable:
    "PDF rendering (@napi-rs/canvas) is not available on this server. A native dependency is missing.",
  qpdfAvailable: "The qpdf binary is not installed on this server.",
};

/** Pure resolver for `FeatureGate`'s notice text — testable without rendering. */
export function resolveFeatureGateMessage(
  feature: FeatureKey,
  envVar?: string,
  unavailableReason?: string,
): string {
  const resolvedEnvVar = envVar ?? FEATURE_ENV_VAR[feature];
  // Phrased as admin guidance, not a direct instruction to the end user (r11 review L-14): an
  // env var is something the server operator sets, not something the person looking at this
  // screen can act on themselves.
  if (resolvedEnvVar)
    return `Not available on this server (${resolvedEnvVar} is not set). Ask the operator to set ${resolvedEnvVar}=true to enable it.`;
  const resolvedReason = unavailableReason ?? FEATURE_CAPABILITY_REASON[feature];
  return resolvedReason ?? "This feature is not available on this server.";
}

export interface FeatureGateProps {
  feature: FeatureKey;
  features: Features;
  /** Overrides the default env var / capability-reason lookup for this feature. */
  envVar?: string;
  unavailableReason?: string;
  children: ReactNode;
}

/**
 * Gates `children` behind a `health.features` flag. When the feature is off, shows a notice
 * naming the exact env var to enable it (or, for native-capability flags with no env toggle,
 * the reason it's unavailable) instead of silently hiding the control.
 */
export function FeatureGate({
  feature,
  features,
  envVar,
  unavailableReason,
  children,
}: FeatureGateProps) {
  if (features[feature]) return <>{children}</>;
  return (
    <Alert data-testid={`feature-gate-${feature}`}>
      <AlertTitle>Not available</AlertTitle>
      <AlertDescription>
        {resolveFeatureGateMessage(feature, envVar, unavailableReason)}
      </AlertDescription>
    </Alert>
  );
}
