import { Option, Schema } from "effect";
import { fetchWithTimeout } from "@mattrax/net";
import { parseAppleStoreLookup } from "@mattrax/enterprise-domain";
import type { AppleStoreLookup } from "@mattrax/enterprise-domain";

/**
 * iTunes Search API lookup for one App Store storefront.
 *
 * The API is public and keyless. Passing `country` selects the storefront, so
 * the same bundle id can resolve to a different `trackId` when a vendor
 * publishes per-market records, and to no result when the app is unavailable
 * in that store.
 */

export const APP_STORE_LOOKUP_BASE_URL = "https://itunes.apple.com";

export type AppStoreLookupConfig = {
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
};

export type AppStoreLookupOutcome =
  | { readonly ok: true; readonly lookup: AppleStoreLookup }
  | { readonly ok: false; readonly error: string };

export const lookupAppStoreApplication = async (input: {
  readonly region: string;
  readonly storeId?: string | null;
  readonly bundleId?: string | null;
  readonly config?: AppStoreLookupConfig;
}): Promise<AppStoreLookupOutcome> => {
  const params = new URLSearchParams({ country: input.region });

  // Bundle ids are global, so prefer them: a legacy id recorded for another
  // storefront will not necessarily resolve in this one even though the app is
  // present, while the bundle id finds the region-specific record.
  const bundleId = input.bundleId?.trim();

  if (bundleId) params.set("bundleId", bundleId);
  else if (input.storeId?.trim()) params.set("id", input.storeId.trim());
  else
    return { ok: false, error: "Add an App Store ID or bundle ID before checking availability." };

  const baseUrl = (input.config?.baseUrl ?? APP_STORE_LOOKUP_BASE_URL).replace(/\/+$/, "");
  const url = `${baseUrl}/lookup?${params.toString()}`;
  const doFetch = input.config?.fetch ?? globalThis.fetch;

  let response: Response;

  try {
    response = await fetchWithTimeout(
      url,
      { headers: { accept: "application/json" } },
      { fetch: doFetch, timeoutMs: input.config?.timeoutMs ?? 10_000 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return { ok: false, error: `The App Store lookup failed: ${message}` };
  }

  if (!response.ok)
    return {
      ok: false,
      error: `The App Store lookup returned HTTP ${response.status} for ${input.region}.`,
    };

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  const payload = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(body)) ?? null;

  return { ok: true, lookup: parseAppleStoreLookup(payload, input.region) };
};
