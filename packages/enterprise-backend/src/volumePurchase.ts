import { and, eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import { fetchWithTimeout } from "@mattrax/net";
import { openSecret, sealSecret } from "@mattrax/crypto";
import { parsePlist } from "@mattrax/plist";
import { schema, type EnterpriseDb } from "@mattrax/enterprise-core";
import { describeAppleError, parseAppleDate } from "./appleBusinessManager.ts";

/**
 * Apple Volume Purchase Program (VPP / Apps and Books) integration.
 *
 * The current v2 API (`https://vpp.itunes.apple.com/mdm`) authenticates every
 * request with the content token (`sToken`) itself as a bearer token. A content
 * token is a base64-encoded JSON object containing `token`, `expDate` and
 * `orgName`; the whole base64 string is the credential.
 *
 * Licence association is asynchronous: Apple returns an event id and later
 * notifications. Mattrax records the local assignment and exposes the event id;
 * it does not claim the device installed the app until the device reports it.
 */

export type VppErrorKind =
  | "not_configured"
  | "invalid_token"
  | "expired"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "no_license"
  | "invalid_response"
  | "upstream";

export class VppError extends Data.TaggedError("VppError")<{
  message: string;
  kind: VppErrorKind;
  cause?: unknown;
}> {}

const fail = (kind: VppErrorKind, message: string, cause?: unknown) =>
  new VppError({ kind, message, ...(cause === undefined ? {} : { cause }) });

const notConfigured = () =>
  fail("not_configured", "Apple Apps and Books (VPP) is not configured for this tenant.");

const mapVppError = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
  effect.pipe(
    Effect.mapError((cause) =>
      cause instanceof VppError ? cause : fail("upstream", describeAppleError(cause), cause),
    ),
  );

const now = () => new Date();
const iso = (value: Date | null | undefined) =>
  value == null ? null : (value instanceof Date ? value : new Date(value)).toISOString();

const text = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const base64ToBytes = (value: string): Uint8Array => {
  const cleaned = value.replace(/\s/g, "");
  const binary = atob(cleaned);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const jsonToBase64 = (value: unknown) =>
  bytesToBase64(new TextEncoder().encode(JSON.stringify(value)));

const tryJson = (value: string): unknown => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
};

export type VppContentToken = {
  /** The original base64 sToken, sent as the bearer token. */
  readonly contentToken: string;
  /** The organizational-unit token embedded inside the sToken. */
  readonly tokenId: string;
  readonly expiresAt: Date;
  readonly orgName: string;
};

/**
 * Parse an uploaded `.vpptoken`/content token. Apple ships the sToken as a
 * base64 string; accepting raw JSON and plist wrappers as well makes renewals
 * less brittle without weakening validation.
 */
export const parseVppTokenUpload = async (input: {
  readonly content: string;
  readonly encoding?: "text" | "base64";
}): Promise<VppContentToken> => {
  const raw = input.content.trim();
  if (!raw) throw fail("invalid_token", "The uploaded Apps and Books token is empty.");

  const candidates: string[] = [];
  if (input.encoding === "base64") {
    try {
      candidates.push(new TextDecoder().decode(base64ToBytes(raw)));
    } catch {
      // Fall through to the raw value; a base64 sToken is handled below.
    }
  }
  candidates.push(raw);

  let decoded: Record<string, unknown> | undefined;
  let contentToken: string | undefined;
  for (const candidate of candidates) {
    const json = tryJson(candidate);
    const value = record(json);
    if (value) {
      decoded = value;
      // Raw JSON is not itself the base64 sToken Apple expects. Re-encode it
      // so the stored credential is always a valid bearer value.
      contentToken = jsonToBase64(value);
      break;
    }
    // The normal case: the file content is already the base64 sToken.
    try {
      const value = record(tryJson(new TextDecoder().decode(base64ToBytes(candidate))));
      if (value) {
        decoded = value;
        contentToken = candidate.replace(/\s/g, "");
        break;
      }
    } catch {
      // Not base64 JSON.
    }
  }

  if (!decoded && (raw.startsWith("<?xml") || raw.startsWith("<plist"))) {
    const parsed = await Effect.runPromise(parsePlist(raw)).catch(() => undefined);
    const value = record(parsed);
    if (value) {
      decoded = value;
      contentToken = jsonToBase64(value);
    }
  }

  if (!decoded || !contentToken)
    throw fail(
      "invalid_token",
      "Unrecognised Apps and Books token. Upload the .vpptoken content token downloaded from Apple Business Manager.",
    );
  const tokenId = text(decoded.token);
  const orgName = text(decoded.orgName) ?? text(decoded.org_name) ?? text(decoded.orgId);
  const expiresAt = parseAppleDate(decoded.expDate ?? decoded.expiry ?? decoded.expiresAt);
  if (!tokenId)
    throw fail(
      "invalid_token",
      "The Apps and Books token is missing its organizational-unit token.",
    );
  if (!expiresAt)
    throw fail("invalid_token", "The Apps and Books token is missing a valid expiry date.");
  if (!orgName)
    throw fail("invalid_token", "The Apps and Books token is missing its organization name.");
  if (expiresAt.getTime() <= Date.now())
    throw fail(
      "expired",
      "The Apps and Books token has expired. Download a new token from Apple Business Manager.",
    );
  return { contentToken, tokenId, expiresAt, orgName };
};

export const sealVppToken = async (authSecret: string, token: VppContentToken): Promise<string> =>
  sealSecret(authSecret, JSON.stringify({ ...token, expiresAt: token.expiresAt.toISOString() }));

export const openVppToken = async (
  authSecret: string,
  sealed: string,
): Promise<VppContentToken> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await openSecret(authSecret, sealed));
  } catch (cause) {
    throw fail(
      "invalid_token",
      "The stored Apps and Books token could not be decrypted. Re-upload the token.",
      cause,
    );
  }
  const value = record(parsed);
  const contentToken = text(value?.contentToken);
  const tokenId = text(value?.tokenId);
  const orgName = text(value?.orgName);
  const expiresAt = parseAppleDate(value?.expiresAt);
  if (!contentToken || !tokenId || !orgName || !expiresAt)
    throw fail("invalid_token", "The stored Apps and Books token is incomplete.");
  return { contentToken, tokenId, orgName, expiresAt };
};

// ─── VPP v2 client ───────────────────────────────────────────────

export const VPP_BASE_URL = "https://vpp.itunes.apple.com/mdm";

export type VppAsset = {
  readonly adamId: string;
  readonly name?: string;
  readonly bundleId?: string;
  readonly totalCount: number;
  readonly availableCount: number;
  readonly assignedCount: number;
  readonly retiredCount: number;
  readonly pricingParam?: string;
  readonly deviceAssignable: boolean;
  readonly revocable: boolean;
  readonly productType?: string;
  readonly supportedPlatforms: ReadonlyArray<string>;
};

export type VppAssignment = {
  readonly adamId: string;
  readonly serialNumber?: string;
  readonly clientUserId?: string;
  readonly pricingParam?: string;
};

export type VppClient = {
  readonly listAssets: (contentToken: string) => Promise<VppAsset[]>;
  readonly listAssignments: (contentToken: string) => Promise<VppAssignment[]>;
  readonly associateAssets: (
    contentToken: string,
    input: {
      readonly adamId: string;
      readonly pricingParam?: string;
      readonly serialNumbers: ReadonlyArray<string>;
    },
  ) => Promise<{ readonly eventId?: string }>;
  readonly disassociateAssets: (
    contentToken: string,
    input: {
      readonly adamId: string;
      readonly pricingParam?: string;
      readonly serialNumbers: ReadonlyArray<string>;
    },
  ) => Promise<{ readonly eventId?: string }>;
  readonly revokeAssets: (
    contentToken: string,
    input: { readonly serialNumbers: ReadonlyArray<string> },
  ) => Promise<{ readonly eventId?: string }>;
  readonly getEventStatus: (
    contentToken: string,
    eventId: string,
  ) => Promise<{ readonly eventStatus?: string; readonly eventType?: string }>;
};

export type VppApiConfig = {
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
};

const vppErrorKind = (status: number): VppErrorKind => {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "upstream";
  return "upstream";
};

export const makeVppClient = (config: VppApiConfig = {}): VppClient => {
  const doFetch = config.fetch ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? 15_000;
  const baseUrl = (config.baseUrl ?? VPP_BASE_URL).replace(/\/+$/, "");

  const request = async <T>(
    path: string,
    contentToken: string,
    init: RequestInit = {},
  ): Promise<T> => {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          ...init,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${contentToken}`,
            ...(init.body ? { "content-type": "application/json" } : {}),
            ...(init.headers as Record<string, string> | undefined),
          },
        },
        { fetch: doFetch, timeoutMs },
      );
    } catch (cause) {
      throw fail("upstream", `Apple VPP request failed: ${describeAppleError(cause)}`, cause);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as
        | { errorMessage?: string; errorNumber?: number }
        | undefined;
      throw fail(
        vppErrorKind(response.status),
        body?.errorMessage
          ? `Apple Apps and Books rejected the request: ${body.errorMessage}`
          : `Apple Apps and Books returned HTTP ${response.status}.`,
      );
    }
    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch (cause) {
      throw fail("invalid_response", "Apple Apps and Books returned invalid JSON.", cause);
    }
  };

  const paged = async <T>(path: string, contentToken: string, key: string): Promise<T[]> => {
    const items: T[] = [];
    let pageIndex = 0;
    let totalPages = 1;
    do {
      const page = await request<Record<string, unknown>>(
        `${path}${path.includes("?") ? "&" : "?"}pageIndex=${pageIndex}`,
        contentToken,
      );
      const values = page[key];
      if (Array.isArray(values)) items.push(...(values as T[]));
      const total = Number(page.totalPages);
      totalPages = Number.isFinite(total) && total > 0 ? total : 1;
      pageIndex++;
      if (pageIndex > 100)
        throw fail("invalid_response", "Apple Apps and Books pagination exceeded 100 pages.");
    } while (pageIndex < totalPages);
    return items;
  };

  return {
    listAssets: async (contentToken) => {
      const assets = await paged<Record<string, unknown>>("/v2/assets", contentToken, "assets");
      return assets.map((asset) => ({
        adamId: text(asset.adamId) ?? "",
        ...(text(asset.name) ? { name: text(asset.name)! } : {}),
        ...(text(asset.bundleId) ? { bundleId: text(asset.bundleId)! } : {}),
        totalCount: Number(asset.totalCount) || 0,
        availableCount: Number(asset.availableCount) || 0,
        assignedCount: Number(asset.assignedCount) || 0,
        retiredCount: Number(asset.retiredCount) || 0,
        ...(text(asset.pricingParam) ? { pricingParam: text(asset.pricingParam)! } : {}),
        deviceAssignable: asset.deviceAssignable === true,
        revocable: asset.revocable === true,
        ...(text(asset.productType) ? { productType: text(asset.productType)! } : {}),
        supportedPlatforms: Array.isArray(asset.supportedPlatforms)
          ? asset.supportedPlatforms.filter((value): value is string => typeof value === "string")
          : [],
      }));
    },

    listAssignments: async (contentToken) => {
      const assignments = await paged<Record<string, unknown>>(
        "/v2/assignments",
        contentToken,
        "assignments",
      );
      return assignments.map((assignment) => ({
        adamId: text(assignment.adamId) ?? "",
        ...(text(assignment.serialNumber) ? { serialNumber: text(assignment.serialNumber)! } : {}),
        ...(text(assignment.clientUserId) ? { clientUserId: text(assignment.clientUserId)! } : {}),
        ...(text(assignment.pricingParam) ? { pricingParam: text(assignment.pricingParam)! } : {}),
      }));
    },

    associateAssets: async (contentToken, input) => {
      const response = await request<{ eventId?: string }>("/v2/assets/associate", contentToken, {
        method: "POST",
        body: JSON.stringify({
          assets: [
            {
              adamId: input.adamId,
              ...(input.pricingParam ? { pricingParam: input.pricingParam } : {}),
            },
          ],
          serialNumbers: [...input.serialNumbers],
        }),
      });
      return response.eventId ? { eventId: response.eventId } : {};
    },

    disassociateAssets: async (contentToken, input) => {
      const response = await request<{ eventId?: string }>(
        "/v2/assets/disassociate",
        contentToken,
        {
          method: "POST",
          body: JSON.stringify({
            assets: [
              {
                adamId: input.adamId,
                ...(input.pricingParam ? { pricingParam: input.pricingParam } : {}),
              },
            ],
            serialNumbers: [...input.serialNumbers],
          }),
        },
      );
      return response.eventId ? { eventId: response.eventId } : {};
    },

    revokeAssets: async (contentToken, input) => {
      const response = await request<{ eventId?: string }>("/v2/assets/revoke", contentToken, {
        method: "POST",
        body: JSON.stringify({ serialNumbers: [...input.serialNumbers] }),
      });
      return response.eventId ? { eventId: response.eventId } : {};
    },

    getEventStatus: async (contentToken, eventId) => {
      const response = await request<{ eventStatus?: string; eventType?: string }>(
        `/v2/status?eventId=${encodeURIComponent(eventId)}`,
        contentToken,
      );
      return {
        ...(response.eventStatus ? { eventStatus: response.eventStatus } : {}),
        ...(response.eventType ? { eventType: response.eventType } : {}),
      };
    },
  };
};

// ─── Persistence and service operations ──────────────────────────

export type VppTokenRow = typeof schema.vppToken.$inferSelect;
export type VppAssetRow = typeof schema.vppAsset.$inferSelect;
export type DeviceVppAssignmentRow = typeof schema.deviceVppAssignment.$inferSelect;

export const loadVppToken = (
  db: EnterpriseDb,
  organizationId: string,
): Effect.Effect<VppTokenRow | undefined, unknown> =>
  db.query.vppToken.findFirst({ where: { organizationId } }) as Effect.Effect<
    VppTokenRow | undefined,
    unknown
  >;

export type VppInfo = {
  readonly configured: boolean;
  readonly status: VppTokenRow["status"];
  readonly appleOrgId: string | null;
  readonly tokenExpiresAt: string | null;
  readonly lastSyncedAt: string | null;
  readonly lastError: string | null;
  readonly assets: number;
  readonly totalLicenses: number;
  readonly availableLicenses: number;
  readonly assignedLicenses: number;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
};

export const vppInfo = (
  db: EnterpriseDb,
  organizationId: string,
): Effect.Effect<VppInfo, VppError> =>
  Effect.gen(function* () {
    const row = yield* loadVppToken(db, organizationId);
    const assets = (yield* db
      .select()
      .from(schema.vppAsset)
      .where(eq(schema.vppAsset.organizationId, organizationId))) as VppAssetRow[];
    return {
      configured: Boolean(row),
      status: row?.status ?? "unconfigured",
      appleOrgId: row?.appleOrgId ?? null,
      tokenExpiresAt: iso(row?.tokenExpiry ?? null),
      lastSyncedAt: iso(row?.lastSyncedAt ?? null),
      lastError: row?.lastError ?? null,
      assets: assets.length,
      totalLicenses: assets.reduce((sum, asset) => sum + asset.totalLicenses, 0),
      availableLicenses: assets.reduce((sum, asset) => sum + asset.availableLicenses, 0),
      assignedLicenses: assets.reduce((sum, asset) => sum + asset.assignedLicenses, 0),
      createdAt: iso(row?.createdAt ?? null),
      updatedAt: iso(row?.updatedAt ?? null),
    };
  }).pipe(mapVppError);

const upsertVppRow = (
  db: EnterpriseDb,
  organizationId: string,
  patch: Partial<typeof schema.vppToken.$inferInsert>,
  existing: VppTokenRow | undefined,
) =>
  existing
    ? db
        .update(schema.vppToken)
        .set({ ...patch, updatedAt: now() })
        .where(eq(schema.vppToken.organizationId, organizationId))
    : db.insert(schema.vppToken).values({
        organizationId,
        encryptedToken: "",
        status: "unconfigured",
        ...patch,
        createdAt: now(),
        updatedAt: now(),
      } as typeof schema.vppToken.$inferInsert);

export const saveVppToken = (input: {
  readonly db: EnterpriseDb;
  readonly organizationId: string;
  readonly authSecret?: string;
  readonly upload: { readonly content: string; readonly encoding?: "text" | "base64" };
  readonly config?: VppApiConfig;
}): Effect.Effect<VppInfo, VppError> =>
  Effect.gen(function* () {
    if (!input.authSecret)
      return yield* Effect.fail(
        fail("not_configured", "AUTH_SECRET is required to store the Apps and Books token."),
      );
    const token = yield* Effect.tryPromise({
      try: () => parseVppTokenUpload(input.upload),
      catch: (cause) =>
        cause instanceof VppError ? cause : fail("invalid_token", describeAppleError(cause), cause),
    });
    const sealed = yield* Effect.tryPromise({
      try: () => sealVppToken(input.authSecret!, token),
      catch: (cause) => fail("upstream", "Could not seal the Apps and Books token.", cause),
    });
    const existing = yield* loadVppToken(input.db, input.organizationId);
    yield* upsertVppRow(
      input.db,
      input.organizationId,
      {
        encryptedToken: sealed,
        tokenExpiry: token.expiresAt,
        appleOrgId: token.orgName,
        status: "active",
        lastError: null,
      },
      existing,
    );

    // Validate against Apple immediately so an expired/revoked token is
    // reported instead of silently accepted.
    const client = makeVppClient(input.config);
    const validation = yield* Effect.tryPromise({
      try: () => client.listAssets(token.contentToken),
      catch: (cause) =>
        cause instanceof VppError ? cause : fail("upstream", describeAppleError(cause), cause),
    }).pipe(Effect.result);
    if (validation._tag === "Failure") {
      yield* upsertVppRow(
        input.db,
        input.organizationId,
        { status: "error", lastError: describeAppleError(validation.failure.message) },
        existing ?? (yield* loadVppToken(input.db, input.organizationId)),
      );
      return yield* Effect.fail(validation.failure);
    }
    return yield* vppInfo(input.db, input.organizationId);
  }).pipe(mapVppError);

export const clearVppToken = (input: {
  readonly db: EnterpriseDb;
  readonly organizationId: string;
}): Effect.Effect<void, VppError> =>
  Effect.gen(function* () {
    yield* input.db
      .delete(schema.vppToken)
      .where(eq(schema.vppToken.organizationId, input.organizationId));
    yield* input.db
      .delete(schema.deviceVppAssignment)
      .where(eq(schema.deviceVppAssignment.organizationId, input.organizationId));
    yield* input.db
      .delete(schema.vppAsset)
      .where(eq(schema.vppAsset.organizationId, input.organizationId));
  }).pipe(mapVppError);

export const syncVppAssets = (input: {
  readonly db: EnterpriseDb;
  readonly organizationId: string;
  readonly authSecret?: string;
  readonly config?: VppApiConfig;
  /** Optional ABM app metadata keyed by adamId (name/bundle id enrichment). */
  readonly appMetadata?: ReadonlyMap<string, { name?: string; bundleId?: string }>;
}): Effect.Effect<
  {
    readonly assets: number;
    readonly totalLicenses: number;
    readonly availableLicenses: number;
    readonly assignedLicenses: number;
    readonly lastSyncedAt: string;
  },
  VppError
> =>
  Effect.gen(function* () {
    const row = yield* loadVppToken(input.db, input.organizationId);
    if (!row) return yield* Effect.fail(notConfigured());
    if (!input.authSecret)
      return yield* Effect.fail(
        fail("not_configured", "AUTH_SECRET is required to decrypt the Apps and Books token."),
      );
    const token = yield* Effect.tryPromise({
      try: () => openVppToken(input.authSecret!, row.encryptedToken),
      catch: (cause) =>
        cause instanceof VppError ? cause : fail("invalid_token", describeAppleError(cause), cause),
    });
    if (token.expiresAt.getTime() <= Date.now())
      return yield* Effect.fail(
        fail("expired", "The Apps and Books token has expired. Download a new token."),
      );

    const client = makeVppClient(input.config);
    const remote = yield* Effect.tryPromise({
      try: () => client.listAssets(token.contentToken),
      catch: (cause) =>
        cause instanceof VppError ? cause : fail("upstream", describeAppleError(cause), cause),
    });
    const catalogue = (yield* input.db
      .select()
      .from(schema.application)
      .where(eq(schema.application.organizationId, input.organizationId))) as Array<{
      name: string;
      storeId: string | null;
      bundleId: string | null;
    }>;
    const catalogueByStoreId = new Map(
      catalogue.filter((app) => app.storeId).map((app) => [app.storeId!, app] as const),
    );
    const local = (yield* input.db
      .select()
      .from(schema.vppAsset)
      .where(eq(schema.vppAsset.organizationId, input.organizationId))) as VppAssetRow[];
    const localByAdamId = new Map(local.map((asset) => [asset.adamId, asset]));
    const remoteIds = new Set(remote.map((asset) => asset.adamId));

    for (const asset of remote) {
      const existing = localByAdamId.get(asset.adamId);
      const catalogueEntry = catalogueByStoreId.get(asset.adamId);
      const metadata = input.appMetadata?.get(asset.adamId);
      const name = metadata?.name ?? asset.name ?? catalogueEntry?.name ?? `App ${asset.adamId}`;
      const bundleId = metadata?.bundleId ?? asset.bundleId ?? catalogueEntry?.bundleId ?? null;
      const patch = {
        name,
        bundleId,
        totalLicenses: asset.totalCount,
        availableLicenses: asset.availableCount,
        assignedLicenses: asset.assignedCount,
        retiredLicenses: asset.retiredCount,
        pricingParam: asset.pricingParam ?? null,
        deviceAssignable: asset.deviceAssignable,
        revocable: asset.revocable,
        productType: asset.productType ?? null,
        supportedPlatforms: asset.supportedPlatforms,
        lastSyncedAt: now(),
        updatedAt: now(),
      };
      if (existing) {
        yield* input.db
          .update(schema.vppAsset)
          .set(patch)
          .where(
            and(
              eq(schema.vppAsset.organizationId, input.organizationId),
              eq(schema.vppAsset.adamId, asset.adamId),
            ),
          );
      } else {
        yield* input.db.insert(schema.vppAsset).values({
          organizationId: input.organizationId,
          adamId: asset.adamId,
          createdAt: now(),
          ...patch,
        });
      }
    }

    // Assets no longer reported keep their row (assignment history) but
    // report zero availability so the UI cannot offer a stale licence.
    for (const asset of local) {
      if (remoteIds.has(asset.adamId)) continue;
      yield* input.db
        .update(schema.vppAsset)
        .set({
          totalLicenses: 0,
          availableLicenses: 0,
          assignedLicenses: 0,
          retiredLicenses: 0,
          lastSyncedAt: now(),
          updatedAt: now(),
        })
        .where(
          and(
            eq(schema.vppAsset.organizationId, input.organizationId),
            eq(schema.vppAsset.adamId, asset.adamId),
          ),
        );
    }

    const result = {
      assets: remote.length,
      totalLicenses: remote.reduce((sum, asset) => sum + asset.totalCount, 0),
      availableLicenses: remote.reduce((sum, asset) => sum + asset.availableCount, 0),
      assignedLicenses: remote.reduce((sum, asset) => sum + asset.assignedCount, 0),
    };
    const syncedAt = now();
    yield* input.db
      .update(schema.vppToken)
      .set({ status: "active", lastSyncedAt: syncedAt, lastError: null, updatedAt: syncedAt })
      .where(eq(schema.vppToken.organizationId, input.organizationId));
    return { ...result, lastSyncedAt: syncedAt.toISOString() };
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        yield* Effect.gen(function* () {
          yield* input.db
            .update(schema.vppToken)
            .set({
              status: "error",
              lastError: describeAppleError(error instanceof VppError ? error.message : error),
              updatedAt: now(),
            })
            .where(eq(schema.vppToken.organizationId, input.organizationId));
        }).pipe(Effect.catch(() => Effect.void));
        return yield* Effect.fail(error);
      }),
    ),
    mapVppError,
  );

export const findVppAsset = (
  db: EnterpriseDb,
  organizationId: string,
  adamId: string,
): Effect.Effect<VppAssetRow | undefined, unknown> =>
  db.query.vppAsset.findFirst({ where: { organizationId, adamId } }) as Effect.Effect<
    VppAssetRow | undefined,
    unknown
  >;

export const findVppAssetByStoreId = (
  db: EnterpriseDb,
  organizationId: string,
  storeId: string,
): Effect.Effect<VppAssetRow | undefined, unknown> => findVppAsset(db, organizationId, storeId);

const updateAssetCounts = (
  db: EnterpriseDb,
  organizationId: string,
  adamId: string,
  direction: "consume" | "release",
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const asset = (yield* findVppAsset(db, organizationId, adamId)) as VppAssetRow | undefined;
    if (!asset) return;
    const available =
      direction === "consume"
        ? Math.max(0, asset.availableLicenses - 1)
        : asset.availableLicenses + 1;
    const assigned =
      direction === "consume"
        ? asset.assignedLicenses + 1
        : Math.max(0, asset.assignedLicenses - 1);
    yield* db
      .update(schema.vppAsset)
      .set({ availableLicenses: available, assignedLicenses: assigned, updatedAt: now() })
      .where(
        and(eq(schema.vppAsset.organizationId, organizationId), eq(schema.vppAsset.adamId, adamId)),
      );
  });

export type VppAssignResult = {
  readonly deviceId: string;
  readonly serial: string;
  readonly adamId: string;
  readonly eventId?: string;
};

/**
 * Consume one licence and associate it with a device serial. Idempotent: an
 * existing `assigned` row is returned without contacting Apple again.
 */
export const assignVppLicence = (input: {
  readonly db: EnterpriseDb;
  readonly organizationId: string;
  readonly deviceId: string;
  readonly adamId: string;
  readonly authSecret?: string;
  readonly config?: VppApiConfig;
}): Effect.Effect<VppAssignResult, VppError> =>
  Effect.gen(function* () {
    const row = yield* loadVppToken(input.db, input.organizationId);
    if (!row) return yield* Effect.fail(notConfigured());
    if (!input.authSecret)
      return yield* Effect.fail(
        fail("not_configured", "AUTH_SECRET is required to decrypt the Apps and Books token."),
      );
    const device = (yield* input.db.query.device.findFirst({
      where: { id: input.deviceId, organizationId: input.organizationId },
    })) as { id: string; serial: string | null } | undefined;
    if (!device) return yield* Effect.fail(fail("not_found", "Device not found in this tenant."));
    if (!device.serial)
      return yield* Effect.fail(
        fail("conflict", "The device has no serial number; VPP licences are assigned by serial."),
      );

    // A VPP install is addressed by the application's store id (adamId), which
    // the caller passes through `findVppAssetByStoreId`.
    const assetId = input.adamId;
    if (!assetId) return yield* Effect.fail(fail("invalid_token", "No VPP asset was selected."));
    const asset = (yield* findVppAsset(input.db, input.organizationId, assetId)) as
      | VppAssetRow
      | undefined;
    if (!asset)
      return yield* Effect.fail(fail("not_found", "No VPP licence pool exists for this app."));
    if (!asset.deviceAssignable)
      return yield* Effect.fail(
        fail(
          "conflict",
          "This VPP asset cannot be assigned to devices (it is user-assignable only).",
        ),
      );
    if (asset.availableLicenses <= 0)
      return yield* Effect.fail(fail("no_license", "No VPP licences are available for this app."));

    const existing = (yield* input.db.query.deviceVppAssignment.findFirst({
      where: {
        organizationId: input.organizationId,
        deviceId: device.id,
        adamId: assetId,
      },
    })) as DeviceVppAssignmentRow | undefined;
    if (existing?.state === "assigned")
      return {
        deviceId: device.id,
        serial: device.serial,
        adamId: assetId,
        ...(existing.eventId ? { eventId: existing.eventId } : {}),
      };

    const token = yield* Effect.tryPromise({
      try: () => openVppToken(input.authSecret!, row.encryptedToken),
      catch: (cause) =>
        cause instanceof VppError ? cause : fail("invalid_token", describeAppleError(cause), cause),
    });
    if (token.expiresAt.getTime() <= Date.now())
      return yield* Effect.fail(fail("expired", "The Apps and Books token has expired."));

    const client = makeVppClient(input.config);
    const associated = yield* Effect.tryPromise({
      try: () =>
        client.associateAssets(token.contentToken, {
          adamId: assetId,
          ...(asset.pricingParam ? { pricingParam: asset.pricingParam } : {}),
          serialNumbers: [device.serial!],
        }),
      catch: (cause) =>
        cause instanceof VppError ? cause : fail("upstream", describeAppleError(cause), cause),
    });

    const timestamp = now();
    const patch = {
      serial: device.serial,
      pricingParam: asset.pricingParam,
      state: "assigned" as const,
      eventId: associated.eventId ?? null,
      lastError: null,
      updatedAt: timestamp,
    };
    if (existing) {
      yield* input.db
        .update(schema.deviceVppAssignment)
        .set(patch)
        .where(
          and(
            eq(schema.deviceVppAssignment.organizationId, input.organizationId),
            eq(schema.deviceVppAssignment.deviceId, device.id),
            eq(schema.deviceVppAssignment.adamId, assetId),
          ),
        );
    } else {
      yield* input.db.insert(schema.deviceVppAssignment).values({
        organizationId: input.organizationId,
        deviceId: device.id,
        adamId: assetId,
        createdAt: timestamp,
        ...patch,
      });
    }
    yield* updateAssetCounts(input.db, input.organizationId, assetId, "consume");
    return {
      deviceId: device.id,
      serial: device.serial,
      adamId: assetId,
      ...(associated.eventId ? { eventId: associated.eventId } : {}),
    };
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        // Record a failed attempt so the device UI can explain why no licence
        // was consumed. Do not decrement counts on failure.
        const device = (yield* input.db.query.device.findFirst({
          where: { id: input.deviceId, organizationId: input.organizationId },
        })) as { id: string; serial: string | null } | undefined;
        const assetId = input.adamId;
        if (device && assetId) {
          const existing = (yield* input.db.query.deviceVppAssignment.findFirst({
            where: {
              organizationId: input.organizationId,
              deviceId: device.id,
              adamId: assetId,
            },
          })) as DeviceVppAssignmentRow | undefined;
          const patch = {
            serial: device.serial ?? "",
            state: "failed" as const,
            lastError: describeAppleError(error instanceof VppError ? error.message : error),
            updatedAt: now(),
          };
          if (existing) {
            yield* input.db
              .update(schema.deviceVppAssignment)
              .set(patch)
              .where(
                and(
                  eq(schema.deviceVppAssignment.organizationId, input.organizationId),
                  eq(schema.deviceVppAssignment.deviceId, device.id),
                  eq(schema.deviceVppAssignment.adamId, assetId),
                ),
              );
          } else {
            yield* input.db.insert(schema.deviceVppAssignment).values({
              organizationId: input.organizationId,
              deviceId: device.id,
              adamId: assetId,
              createdAt: now(),
              ...patch,
            });
          }
        }
        return yield* Effect.fail(error);
      }),
    ),
    mapVppError,
  );

export const releaseVppLicence = (input: {
  readonly db: EnterpriseDb;
  readonly organizationId: string;
  readonly deviceId: string;
  readonly adamId: string;
  readonly authSecret?: string;
  readonly config?: VppApiConfig;
}): Effect.Effect<{ readonly released: boolean; readonly eventId?: string }, VppError> =>
  Effect.gen(function* () {
    const row = yield* loadVppToken(input.db, input.organizationId);
    if (!row) return yield* Effect.fail(notConfigured());
    if (!input.authSecret)
      return yield* Effect.fail(
        fail("not_configured", "AUTH_SECRET is required to decrypt the Apps and Books token."),
      );
    const device = (yield* input.db.query.device.findFirst({
      where: { id: input.deviceId, organizationId: input.organizationId },
    })) as { id: string; serial: string | null } | undefined;
    if (!device?.serial)
      return yield* Effect.fail(fail("not_found", "Device not found in this tenant."));
    const asset = (yield* findVppAsset(input.db, input.organizationId, input.adamId)) as
      | VppAssetRow
      | undefined;
    if (!asset)
      return yield* Effect.fail(fail("not_found", "No VPP licence pool exists for this app."));
    if (!asset.revocable)
      return yield* Effect.fail(
        fail("conflict", "This VPP licence is irrevocable and cannot be returned to the pool."),
      );
    const assignment = (yield* input.db.query.deviceVppAssignment.findFirst({
      where: {
        organizationId: input.organizationId,
        deviceId: device.id,
        adamId: input.adamId,
      },
    })) as DeviceVppAssignmentRow | undefined;
    if (assignment?.state !== "assigned")
      return yield* Effect.fail(
        fail("conflict", "This device has no active VPP licence assignment for the app."),
      );
    const token = yield* Effect.tryPromise({
      try: () => openVppToken(input.authSecret!, row.encryptedToken),
      catch: (cause) =>
        cause instanceof VppError ? cause : fail("invalid_token", describeAppleError(cause), cause),
    });
    const client = makeVppClient(input.config);
    const result = yield* Effect.tryPromise({
      try: () =>
        client.disassociateAssets(token.contentToken, {
          adamId: input.adamId,
          ...(asset.pricingParam ? { pricingParam: asset.pricingParam } : {}),
          serialNumbers: [device.serial!],
        }),
      catch: (cause) =>
        cause instanceof VppError ? cause : fail("upstream", describeAppleError(cause), cause),
    });
    yield* input.db
      .update(schema.deviceVppAssignment)
      .set({
        state: "revoked",
        lastError: null,
        eventId: result.eventId ?? null,
        updatedAt: now(),
      })
      .where(
        and(
          eq(schema.deviceVppAssignment.organizationId, input.organizationId),
          eq(schema.deviceVppAssignment.deviceId, device.id),
          eq(schema.deviceVppAssignment.adamId, input.adamId),
        ),
      );
    yield* updateAssetCounts(input.db, input.organizationId, input.adamId, "release");
    return {
      released: true,
      ...(result.eventId ? { eventId: result.eventId } : {}),
    };
  }).pipe(mapVppError);
