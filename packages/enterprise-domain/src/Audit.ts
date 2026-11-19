import { Schema } from "effect";
import { NullableString } from "./Errors.js";

/**
 * Which stream an organisation event belongs to.
 *
 * - `account`: a signed-in account, API token or MCP connection performed it.
 * - `mdm`: a device protocol request (check-in, policy delivery, command
 *   result, failure). The actor is always the system sentinel.
 * - `system`: background work with no request (maintenance alerts, scheduled
 *   rotation, delivery failures).
 */
export const AUDIT_CATEGORIES = ["account", "mdm", "system"] as const;

export const AuditCategory = Schema.Literals(AUDIT_CATEGORIES);

export type AuditCategory = "account" | "mdm" | "system";

export const AUDIT_ACTOR_TYPES = ["account", "system", "api-token"] as const;

export const AuditActorType = Schema.Literals(AUDIT_ACTOR_TYPES);

export type AuditActorType = "account" | "system" | "api-token";

export const AUDIT_PROTOCOLS = ["apple", "win", "android"] as const;

export const AuditProtocol = Schema.Literals(AUDIT_PROTOCOLS);

export type AuditProtocol = "apple" | "win" | "android";

/**
 * One organisation event.
 *
 * `ip` is the verified client address; the deployment's trusted-proxy policy
 * decides whether it can be recorded at all. Certificate fields are hashes and
 * serials, never PEM material, and `metadata` is a bounded, secret-free object.
 *
 * The decoded type is written out rather than inferred: the HTTP API group is
 * already at TypeScript's declaration-size limit, and this struct is embedded
 * in three responses. An explicit annotation keeps the group's emitted type
 * small without dropping any field.
 */
export type AuditLogEntry = {
  readonly id: string;
  readonly action: string;
  readonly category: AuditCategory;
  readonly targetType: string;
  readonly targetId?: string | null;
  readonly actorAccountId?: string | null;
  readonly actorEmail?: string | null;
  readonly actorType: AuditActorType;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly deviceId?: string | null;
  readonly deviceCertificateFingerprint?: string | null;
  readonly deviceCertificateSerial?: string | null;
  /** Apple user-channel id when the event belongs to one login on a device. */
  readonly principalId?: string | null;
  readonly protocol?: AuditProtocol | null;
  readonly metadata?: unknown;
  readonly createdAt: string;
};

// SAFETY: `Schema.Struct` for this field set produces exactly the declared
// shapes (optional nullable strings and an optional JSON/unknown metadata). The
// annotation exists only to keep the HTTP API group's emitted type small.
export const AuditLogEntry: Schema.Codec<AuditLogEntry> = Schema.Struct({
  id: Schema.String,
  action: Schema.String,
  category: AuditCategory,
  targetType: Schema.String,
  targetId: Schema.optional(NullableString),
  actorAccountId: Schema.optional(NullableString),
  actorEmail: Schema.optional(NullableString),
  actorType: AuditActorType,
  ip: Schema.optional(NullableString),
  userAgent: Schema.optional(NullableString),
  deviceId: Schema.optional(NullableString),
  deviceCertificateFingerprint: Schema.optional(NullableString),
  deviceCertificateSerial: Schema.optional(NullableString),
  principalId: Schema.optional(NullableString),
  protocol: Schema.optional(Schema.NullOr(AuditProtocol)),
  metadata: Schema.optional(Schema.NullOr(Schema.Unknown)),
  createdAt: Schema.String,
}) as Schema.Codec<AuditLogEntry>;

/**
 * Audit search filters. `cursor` is opaque and may encode a keyset position
 * (`createdAt` + `id`) or a legacy offset; `offset` is accepted for callers
 * that page numerically. Dates are ISO timestamps, inclusive on both ends.
 *
 * `q` is a free-text match over the action, actor email, target, device id, IP
 * and certificate serial/fingerprint. It is intended for an operator looking
 * up a single event, not for bulk search: every other filter narrows the scan
 * first.
 */
export type AuditSearchQuery = {
  readonly action?: string;
  /** Matches actor email or user id (case-insensitive substring). */
  readonly actor?: string;
  readonly actorType?: AuditActorType;
  readonly category?: AuditCategory;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly protocol?: AuditProtocol;
  /** Internal device id; the device page passes its own id. */
  readonly deviceId?: string;
  /** Free text across action, actor, target, device, IP and certificate. */
  readonly q?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
  readonly cursor?: string;
  readonly offset?: number;
};

export const AuditSearchQuery = Schema.Struct({
  action: Schema.optional(Schema.String),
  actor: Schema.optional(Schema.String),
  actorType: Schema.optional(AuditActorType),
  category: Schema.optional(AuditCategory),
  targetType: Schema.optional(Schema.String),
  targetId: Schema.optional(Schema.String),
  protocol: Schema.optional(AuditProtocol),
  deviceId: Schema.optional(Schema.String),
  q: Schema.optional(Schema.String),
  from: Schema.optional(Schema.String),
  to: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  cursor: Schema.optional(Schema.String),
  offset: Schema.optional(Schema.Number),
});

export const AuditLogResponse = Schema.Struct({
  entries: Schema.Array(AuditLogEntry),
});

export type AuditLogResponse = typeof AuditLogResponse.Type;

export const AuditSearchResponse = Schema.Struct({
  entries: Schema.Array(AuditLogEntry),
  nextCursor: Schema.NullOr(Schema.String),
});

export type AuditSearchResponse = typeof AuditSearchResponse.Type;

export type AuditExportQuery = typeof AuditSearchQuery.Type & {
  readonly format?: "csv" | "json";
};

export const AuditExportQuery = Schema.Struct({
  ...AuditSearchQuery.fields,
  format: Schema.optional(Schema.Literals(["csv", "json"])),
});

export const CreateInvitationResponse = Schema.Struct({
  id: Schema.String,
  /** The one-time acceptance link. Returned once and never persisted in clear. */
  inviteUrl: Schema.String,
  expiresAt: Schema.String,
  emailSent: Schema.Boolean,
});
