import { ApplicationId, openSecret, sealSecret } from "@mattrax/crypto";
import { and, eq } from "drizzle-orm";
import { Effect, Layer, Option, Predicate, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { parsePlist, PlistValue } from "@mattrax/plist";
import { schema } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { describeAppleError, parseAppleDate } from "./appleBusinessManager.ts";
import { VppError } from "./errors.js";
import type { VppErrorKind } from "./errors.js";

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

export { VppError };
export type { VppErrorKind };

const fail = (kind: VppErrorKind, message: string, cause?: unknown) =>
  new VppError({ kind, message, cause });

const notConfigured = () =>
  fail("not_configured", "Apple Apps and Books (VPP) is not configured for this tenant.");

const mapVppError = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
  effect.pipe(
    Effect.mapError((cause) =>
      cause instanceof VppError ? cause : fail("upstream", describeAppleError(cause), cause),
    ),
  );

const now = () => new Date();

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

type CredentialValue = Schema.Json | PlistValue | undefined;

type CredentialRecord = Record<string, CredentialValue>;

const CredentialValueSchema = Schema.Union([Schema.Json, PlistValue]);

const CredentialRecordSchema = Schema.Record(Schema.String, CredentialValueSchema);

const iso = (value: Date | null | undefined) =>
  value == null ? null : (value instanceof Date ? value : new Date(value)).toISOString();

const text = (value: CredentialValue): string | undefined => {
  const string = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(value))?.trim();

  if (string) return string;

  const number = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Number)(value));

  return number !== undefined && Number.isFinite(number) ? String(number) : undefined;
};

const record = (value: CredentialValue): CredentialRecord | undefined =>
  Schema.is(CredentialRecordSchema)(value) ? value : undefined;

const base64ToBytes = (value: string): Uint8Array => {
  const cleaned = value.replaceAll(/\s/g, "");
  const binary = atob(cleaned);

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};

const jsonToBase64 = (value: Schema.Json) =>
  bytesToBase64(new TextEncoder().encode(JSON.stringify(value)));

const tryJson = (value: string): Schema.Json | undefined => {
  const trimmed = value.trim();

  if (!trimmed.startsWith("{")) return undefined;

  try {
    return Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(JSON.parse(trimmed)));
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

  let decoded: CredentialRecord | undefined;
  let contentToken: string | undefined;
  let fromPlist = false;

  for (const candidate of candidates) {
    const json = tryJson(candidate);
    const value = record(json);

    if (value && json) {
      decoded = value;
      // Raw JSON is not itself the base64 sToken Apple expects. Re-encode it
      // so the stored credential is always a valid bearer value.
      contentToken = jsonToBase64(json);
      break;
    }

    // The normal case: the file content is already the base64 sToken.
    try {
      const value = record(tryJson(new TextDecoder().decode(base64ToBytes(candidate))));

      if (value) {
        decoded = value;
        contentToken = candidate.replaceAll(/\s/g, "");
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
      fromPlist = true;
    }
  }

  if (!decoded)
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

  if (fromPlist)
    contentToken = jsonToBase64({
      token: tokenId,
      expDate: expiresAt.toISOString(),
      orgName,
    });

  if (!contentToken)
    throw fail(
      "invalid_token",
      "Unrecognised Apps and Books token. Upload the .vpptoken content token downloaded from Apple Business Manager.",
    );

  return { contentToken, tokenId, expiresAt, orgName };
};

export const sealVppToken = async (authSecret: string, token: VppContentToken): Promise<string> =>
  sealSecret(authSecret, JSON.stringify({ ...token, expiresAt: token.expiresAt.toISOString() }));

export const openVppToken = async (
  authSecret: string,
  sealed: string,
): Promise<VppContentToken> => {
  let parsed: Schema.Json | undefined;

  try {
    parsed = JSON.parse(await openSecret(authSecret, sealed));
  } catch (error) {
    throw fail(
      "invalid_token",
      "The stored Apps and Books token could not be decrypted. Re-upload the token.",
      error,
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

/** Apple answers fast or the token is dead; never hold a sync open. */
export const VPP_REQUEST_TIMEOUT_MS = 15_000;

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
  readonly listAssets: (contentToken: string) => Effect.Effect<VppAsset[], VppError>;
  readonly listAssignments: (contentToken: string) => Effect.Effect<VppAssignment[], VppError>;
  readonly associateAssets: (
    contentToken: string,
    input: {
      readonly adamId: string;
      readonly pricingParam?: string;
      readonly serialNumbers: ReadonlyArray<string>;
    },
  ) => Effect.Effect<{ readonly eventId?: string }, VppError>;
  readonly disassociateAssets: (
    contentToken: string,
    input: {
      readonly adamId: string;
      readonly pricingParam?: string;
      readonly serialNumbers: ReadonlyArray<string>;
    },
  ) => Effect.Effect<{ readonly eventId?: string }, VppError>;
  readonly revokeAssets: (
    contentToken: string,
    input: { readonly serialNumbers: ReadonlyArray<string> },
  ) => Effect.Effect<{ readonly eventId?: string }, VppError>;
  readonly getEventStatus: (
    contentToken: string,
    eventId: string,
  ) => Effect.Effect<{ readonly eventStatus?: string; readonly eventType?: string }, VppError>;
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

const VppAssetSchema = Schema.Struct({
  adamId: Schema.NonEmptyString,
  name: Schema.optional(Schema.String),
  bundleId: Schema.optional(Schema.String),
  totalCount: Schema.optional(Schema.Number),
  availableCount: Schema.optional(Schema.Number),
  assignedCount: Schema.optional(Schema.Number),
  retiredCount: Schema.optional(Schema.Number),
  pricingParam: Schema.optional(Schema.String),
  deviceAssignable: Schema.optional(Schema.Boolean),
  revocable: Schema.optional(Schema.Boolean),
  productType: Schema.optional(Schema.String),
  supportedPlatforms: Schema.optional(Schema.Array(Schema.String)),
});

const VppAssignmentSchema = Schema.Struct({
  adamId: Schema.NonEmptyString,
  serialNumber: Schema.optional(Schema.String),
  clientUserId: Schema.optional(Schema.String),
  pricingParam: Schema.optional(Schema.String),
});

const VppEventResponseSchema = Schema.Struct({
  eventId: Schema.optional(Schema.NonEmptyString),
});

const VppEventStatusSchema = Schema.Struct({
  eventStatus: Schema.optional(Schema.String),
  eventType: Schema.optional(Schema.String),
});

const VppErrorResponseSchema = Schema.Struct({
  errorMessage: Schema.optional(Schema.String),
  errorNumber: Schema.optional(Schema.Number),
});

const VppPageSchema = Schema.Record(Schema.String, Schema.Json);

const VppTotalPagesSchema = Schema.Int;

/** Parse JSON without trusting its shape; callers validate it with a Schema. */
export const parseAppleJson = (text: string): Schema.Json | undefined => {
  try {
    return Schema.decodeUnknownSync(Schema.Json)(JSON.parse(text));
  } catch {
    return undefined;
  }
};

export const makeVppClient = (config: VppApiConfig = {}): VppClient => {
  const doFetch = config.fetch ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? VPP_REQUEST_TIMEOUT_MS;
  const baseUrl = (config.baseUrl ?? VPP_BASE_URL).replace(/\/+$/, "");

  // Every method owns its client, so callers never thread a layer.
  const clientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, doFetch)),
  );

  /**
   * One Apple Apps and Books request. The deadline covers the response body as
   * well as the headers, so a stalled page fails like a hung connect.
   */
  const request = <T>(
    schema: Schema.Decoder<T>,
    path: string,
    contentToken: string,
    init: { readonly method?: "POST"; readonly body?: string } = {},
  ): Effect.Effect<T | undefined, VppError, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;

      const base =
        init.method === "POST"
          ? HttpClientRequest.post(`${baseUrl}${path}`).pipe(
              HttpClientRequest.bodyText(init.body ?? "", "application/json"),
            )
          : HttpClientRequest.get(`${baseUrl}${path}`);

      const sent = yield* Effect.gen(function* () {
        const response = yield* client.execute(
          base.pipe(
            HttpClientRequest.setHeaders({
              accept: "application/json",
              authorization: `Bearer ${contentToken}`,
            }),
          ),
        );

        return {
          status: response.status,
          text: yield* response.text.pipe(Effect.orElseSucceed(() => "")),
        };
      }).pipe(
        Effect.mapError((cause) =>
          fail("upstream", `Apple VPP request failed: ${describeAppleError(cause)}`, cause),
        ),
        Effect.timeoutOrElse({
          duration: timeoutMs,
          orElse: () =>
            Effect.fail(fail("upstream", `Apple VPP request timed out after ${timeoutMs}ms`)),
        }),
      );

      if (sent.status < 200 || sent.status > 299) {
        const body = Option.getOrUndefined(
          Schema.decodeUnknownOption(VppErrorResponseSchema)(parseAppleJson(sent.text)),
        );

        return yield* Effect.fail(
          fail(
            vppErrorKind(sent.status),
            body?.errorMessage
              ? `Apple Apps and Books rejected the request: ${body.errorMessage}`
              : `Apple Apps and Books returned HTTP ${sent.status}.`,
          ),
        );
      }

      if (sent.status === 204) return undefined;

      const json = parseAppleJson(sent.text);

      if (json === undefined)
        return yield* Effect.fail(
          fail("invalid_response", "Apple Apps and Books returned invalid JSON."),
        );

      const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(schema)(json));

      if (decoded === undefined)
        return yield* Effect.fail(
          fail("invalid_response", "Apple Apps and Books returned an invalid response shape."),
        );

      return decoded;
    });

  const paged = <T>(
    path: string,
    contentToken: string,
    key: string,
    valueSchema: Schema.Decoder<T>,
  ): Effect.Effect<T[], VppError, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const items: T[] = [];
      let pageIndex = 0;

      while (true) {
        if (pageIndex >= 100)
          return yield* Effect.fail(
            fail("invalid_response", "Apple Apps and Books pagination exceeded 100 pages."),
          );

        const page = yield* request(
          VppPageSchema,
          `${path}${path.includes("?") ? "&" : "?"}pageIndex=${pageIndex}`,
          contentToken,
        );

        const values = Option.getOrUndefined(
          Schema.decodeUnknownOption(Schema.Array(valueSchema))(page?.[key]),
        );

        if (!values)
          return yield* Effect.fail(
            fail(
              "invalid_response",
              `Apple Apps and Books page did not include a valid ${key} array.`,
            ),
          );

        const totalPages = Option.getOrUndefined(
          Schema.decodeUnknownOption(VppTotalPagesSchema)(page?.totalPages),
        );

        if (!totalPages || totalPages < 1)
          return yield* Effect.fail(
            fail("invalid_response", "Apple Apps and Books returned an invalid totalPages value."),
          );

        if (totalPages > 100)
          return yield* Effect.fail(
            fail("invalid_response", "Apple Apps and Books pagination exceeded 100 pages."),
          );

        items.push(...values);
        pageIndex++;

        if (pageIndex >= totalPages) break;
      }

      return items;
    });

  const listAssets = (contentToken: string): Effect.Effect<VppAsset[], VppError> =>
    Effect.gen(function* () {
      const assets = yield* paged("/v2/assets", contentToken, "assets", VppAssetSchema);

      return assets.map((asset) => {
        const result: Mutable<VppAsset> = {
          adamId: asset.adamId,
          totalCount: asset.totalCount ?? 0,
          availableCount: asset.availableCount ?? 0,
          assignedCount: asset.assignedCount ?? 0,
          retiredCount: asset.retiredCount ?? 0,
          deviceAssignable: asset.deviceAssignable ?? false,
          revocable: asset.revocable ?? false,
          supportedPlatforms: asset.supportedPlatforms ?? [],
        };

        const name = text(asset.name);
        const bundleId = text(asset.bundleId);
        const pricingParam = text(asset.pricingParam);
        const productType = text(asset.productType);

        if (name) result.name = name;
        if (bundleId) result.bundleId = bundleId;
        if (pricingParam) result.pricingParam = pricingParam;
        if (productType) result.productType = productType;

        return result;
      });
    }).pipe(Effect.provide(clientLayer));

  const listAssignments = (contentToken: string): Effect.Effect<VppAssignment[], VppError> =>
    Effect.gen(function* () {
      const assignments = yield* paged(
        "/v2/assignments",
        contentToken,
        "assignments",
        VppAssignmentSchema,
      );

      return assignments.map((assignment) => {
        const result: Mutable<VppAssignment> = { adamId: assignment.adamId };
        const serialNumber = assignment.serialNumber;
        const clientUserId = assignment.clientUserId;
        const pricingParam = assignment.pricingParam;

        if (serialNumber) result.serialNumber = serialNumber;
        if (clientUserId) result.clientUserId = clientUserId;
        if (pricingParam) result.pricingParam = pricingParam;

        return result;
      });
    }).pipe(Effect.provide(clientLayer));

  const associateAssets = (
    contentToken: string,
    input: {
      readonly adamId: string;
      readonly pricingParam?: string;
      readonly serialNumbers: ReadonlyArray<string>;
    },
  ): Effect.Effect<{ readonly eventId?: string }, VppError> =>
    Effect.gen(function* () {
      const response = yield* request(
        VppEventResponseSchema,
        "/v2/assets/associate",
        contentToken,
        {
          method: "POST",
          body: JSON.stringify({
            assets: [{ adamId: input.adamId, pricingParam: input.pricingParam }],
            serialNumbers: [...input.serialNumbers],
          }),
        },
      );

      return response?.eventId ? { eventId: response.eventId } : {};
    }).pipe(Effect.provide(clientLayer));

  const disassociateAssets = (
    contentToken: string,
    input: {
      readonly adamId: string;
      readonly pricingParam?: string;
      readonly serialNumbers: ReadonlyArray<string>;
    },
  ): Effect.Effect<{ readonly eventId?: string }, VppError> =>
    Effect.gen(function* () {
      const response = yield* request(
        VppEventResponseSchema,
        "/v2/assets/disassociate",
        contentToken,
        {
          method: "POST",
          body: JSON.stringify({
            assets: [{ adamId: input.adamId, pricingParam: input.pricingParam }],
            serialNumbers: [...input.serialNumbers],
          }),
        },
      );

      return response?.eventId ? { eventId: response.eventId } : {};
    }).pipe(Effect.provide(clientLayer));

  const revokeAssets = (
    contentToken: string,
    input: { readonly serialNumbers: ReadonlyArray<string> },
  ): Effect.Effect<{ readonly eventId?: string }, VppError> =>
    Effect.gen(function* () {
      const response = yield* request(VppEventResponseSchema, "/v2/assets/revoke", contentToken, {
        method: "POST",
        body: JSON.stringify({ serialNumbers: [...input.serialNumbers] }),
      });

      return response?.eventId ? { eventId: response.eventId } : {};
    }).pipe(Effect.provide(clientLayer));

  const getEventStatus = (
    contentToken: string,
    eventId: string,
  ): Effect.Effect<{ readonly eventStatus?: string; readonly eventType?: string }, VppError> =>
    Effect.gen(function* () {
      const response = yield* request(
        VppEventStatusSchema,
        `/v2/status?eventId=${encodeURIComponent(eventId)}`,
        contentToken,
      );

      return {
        eventStatus: response?.eventStatus,
        eventType: response?.eventType,
      };
    }).pipe(Effect.provide(clientLayer));

  return {
    listAssets,
    listAssignments,
    associateAssets,
    disassociateAssets,
    revokeAssets,
    getEventStatus,
  };
}; // ─── Persistence and service operations ──────────────────────────

export type VppTokenRow = typeof schema.vppToken.$inferSelect;

export type VppAssetRow = typeof schema.vppAsset.$inferSelect;

export type DeviceVppAssignmentRow = typeof schema.deviceVppAssignment.$inferSelect;

export const loadVppToken = (
  db: EnterpriseDb,
  organizationId: string,
): Effect.Effect<VppTokenRow | undefined, unknown> =>
  db.query.vppToken.findFirst({ where: { organizationId } });

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

    const assets = yield* db
      .select()
      .from(schema.vppAsset)
      .where(eq(schema.vppAsset.organizationId, organizationId));

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
      } satisfies typeof schema.vppToken.$inferInsert);

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

    const validation = yield* client.listAssets(token.contentToken).pipe(Effect.result);

    if (Predicate.isTagged(validation, "Failure")) {
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

    const remote = yield* client.listAssets(token.contentToken);

    const catalogue = yield* input.db
      .select()
      .from(schema.application)
      .where(eq(schema.application.organizationId, input.organizationId));

    const catalogueByStoreId = new Map(
      catalogue.flatMap((app) => (app.storeId ? [[app.storeId, app] as const] : [])),
    );

    const local = yield* input.db
      .select()
      .from(schema.vppAsset)
      .where(eq(schema.vppAsset.organizationId, input.organizationId));

    const localByAdamId = new Map(local.map((asset) => [asset.adamId, asset]));
    const remoteIds = new Set(remote.map((asset) => asset.adamId));

    const catalogueByBundleId = new Map(
      catalogue.flatMap((app) => (app.bundleId ? [[app.bundleId, app] as const] : [])),
    );

    for (const asset of remote) {
      const existing = localByAdamId.get(asset.adamId);
      const metadata = input.appMetadata?.get(asset.adamId);

      const catalogueEntry =
        catalogueByStoreId.get(asset.adamId) ??
        (asset.bundleId ? catalogueByBundleId.get(asset.bundleId) : undefined);

      const name = metadata?.name ?? asset.name ?? catalogueEntry?.name ?? `App ${asset.adamId}`;
      const bundleId = metadata?.bundleId ?? asset.bundleId ?? catalogueEntry?.bundleId ?? null;

      // A purchased app is only useful if it can be assigned and installed, so
      // the sync maintains the catalogue entry alongside the licence counts.
      // App Store ID is the stable identity Apple reports; an entry that already
      // has a different source (for example an uploaded build) is not rewritten.
      const timestamp = now();

      if (!catalogueEntry) {
        yield* input.db.insert(schema.application).values({
          id: ApplicationId.make(),
          organizationId: input.organizationId,
          name,
          platform: "apple",
          bundleId,
          version: null,
          source: "store",
          manifestUrl: null,
          storeId: asset.adamId,
          fileName: null,
          contentType: null,
          size: null,
          sha256: null,
          r2Key: null,
          notes: "Synced from Apple Apps and Books",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      } else {
        const patch: Partial<typeof schema.application.$inferInsert> = {};

        if (catalogueEntry.name !== name) patch.name = name;

        if (bundleId && catalogueEntry.bundleId !== bundleId) patch.bundleId = bundleId;

        if (Object.keys(patch).length > 0)
          yield* input.db
            .update(schema.application)
            .set({ ...patch, updatedAt: timestamp })
            .where(
              and(
                eq(schema.application.organizationId, input.organizationId),
                eq(schema.application.id, catalogueEntry.id),
              ),
            );
      }

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
  db.query.vppAsset.findFirst({ where: { organizationId, adamId } });

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
    const asset = yield* findVppAsset(db, organizationId, adamId);

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

    const device = yield* input.db.query.device.findFirst({
      where: { id: input.deviceId, organizationId: input.organizationId },
    });

    if (!device) return yield* Effect.fail(fail("not_found", "Device not found in this tenant."));

    if (!device.serial)
      return yield* Effect.fail(
        fail("conflict", "The device has no serial number; VPP licences are assigned by serial."),
      );

    // A VPP install is addressed by the application's store id (adamId), which
    // the caller passes through `findVppAssetByStoreId`.
    const assetId = input.adamId;

    if (!assetId) return yield* Effect.fail(fail("invalid_token", "No VPP asset was selected."));

    const asset = yield* findVppAsset(input.db, input.organizationId, assetId);

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

    const existing = yield* input.db.query.deviceVppAssignment.findFirst({
      where: {
        organizationId: input.organizationId,
        deviceId: device.id,
        adamId: assetId,
      },
    });

    if (existing?.state === "assigned")
      return {
        deviceId: device.id,
        serial: device.serial,
        adamId: assetId,
        eventId: existing.eventId ?? undefined,
      };

    const token = yield* Effect.tryPromise({
      try: () => openVppToken(input.authSecret!, row.encryptedToken),
      catch: (cause) =>
        cause instanceof VppError ? cause : fail("invalid_token", describeAppleError(cause), cause),
    });

    if (token.expiresAt.getTime() <= Date.now())
      return yield* Effect.fail(fail("expired", "The Apps and Books token has expired."));

    const client = makeVppClient(input.config);

    const associated = yield* client.associateAssets(token.contentToken, {
      adamId: assetId,
      pricingParam: asset.pricingParam ?? undefined,
      serialNumbers: [device.serial!],
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
      eventId: associated.eventId,
    };
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        // Record a failed attempt so the device UI can explain why no licence
        // was consumed. Do not decrement counts on failure.
        const device = yield* input.db.query.device.findFirst({
          where: { id: input.deviceId, organizationId: input.organizationId },
        });

        const assetId = input.adamId;

        if (device && assetId) {
          const existing = yield* input.db.query.deviceVppAssignment.findFirst({
            where: {
              organizationId: input.organizationId,
              deviceId: device.id,
              adamId: assetId,
            },
          });

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

    const device = yield* input.db.query.device.findFirst({
      where: { id: input.deviceId, organizationId: input.organizationId },
    });

    if (!device?.serial)
      return yield* Effect.fail(fail("not_found", "Device not found in this tenant."));

    const asset = yield* findVppAsset(input.db, input.organizationId, input.adamId);

    if (!asset)
      return yield* Effect.fail(fail("not_found", "No VPP licence pool exists for this app."));

    if (!asset.revocable)
      return yield* Effect.fail(
        fail("conflict", "This VPP licence is irrevocable and cannot be returned to the pool."),
      );

    const assignment = yield* input.db.query.deviceVppAssignment.findFirst({
      where: {
        organizationId: input.organizationId,
        deviceId: device.id,
        adamId: input.adamId,
      },
    });

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

    const result = yield* client.disassociateAssets(token.contentToken, {
      adamId: input.adamId,
      pricingParam: asset.pricingParam ?? undefined,
      serialNumbers: [device.serial!],
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

    return { released: true, eventId: result.eventId };
  }).pipe(mapVppError);

/** How often a configured Apps and Books token is refreshed automatically. */
export const VPP_SCHEDULED_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type ScheduledVppSyncResult = {
  readonly tenants: number;
  readonly synced: number;
  readonly failed: number;
};

/**
 * Refresh every tenant's Apps and Books assets whose last sync is older than a
 * day.
 *
 * The manual sync endpoint stays the way to force a refresh; this is the
 * backstop that keeps licence counts, assignment names and catalogue rows
 * current when nobody opens the page. Failures are recorded on the token row by
 * `syncVppAssets` and never abort other tenants.
 */
export const syncScheduledVppAssets = (input: {
  readonly db: EnterpriseDb;
  readonly authSecret?: string;
  readonly config?: VppApiConfig;
  readonly now?: Date;
  readonly intervalMs?: number;
}): Effect.Effect<ScheduledVppSyncResult, unknown, never> =>
  Effect.gen(function* () {
    if (!input.authSecret) return { tenants: 0, synced: 0, failed: 0 };

    const now = input.now ?? new Date();
    const interval = input.intervalMs ?? VPP_SCHEDULED_SYNC_INTERVAL_MS;
    const cutoff = now.getTime() - interval;

    const tokens = yield* input.db.select().from(schema.vppToken);

    const due = tokens.filter((token) => {
      if (token.status === "unconfigured") return false;

      if (!token.lastSyncedAt) return true;

      const lastSyncedAt =
        token.lastSyncedAt instanceof Date ? token.lastSyncedAt : new Date(token.lastSyncedAt);

      return Number.isNaN(lastSyncedAt.getTime()) || lastSyncedAt.getTime() <= cutoff;
    });

    const outcomes = yield* Effect.forEach(
      due,
      (token) =>
        syncVppAssets({
          db: input.db,
          organizationId: token.organizationId,
          authSecret: input.authSecret,
          config: input.config,
        }).pipe(Effect.result),
      { concurrency: 4 },
    );

    return {
      tenants: due.length,
      synced: outcomes.filter((outcome) => Predicate.isTagged(outcome, "Success")).length,
      failed: outcomes.filter((outcome) => Predicate.isTagged(outcome, "Failure")).length,
    };
  });
