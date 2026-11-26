export const DEFAULT_E2E_BASE_URL = "http://localhost:9050";

/** Treat missing, empty and whitespace-only overrides as the default target. */
export const normalizeE2EBaseUrl = (value: string | undefined): string | undefined =>
  value?.trim() || undefined;
