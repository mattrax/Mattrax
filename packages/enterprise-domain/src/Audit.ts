import { Schema } from "effect";
import { NullableString } from "./Errors.js";

export const AuditLogEntry = Schema.Struct({
  id: Schema.String,
  action: Schema.String,
  targetType: Schema.String,
  targetId: Schema.optional(NullableString),
  actorAccountId: Schema.optional(NullableString),
  actorEmail: Schema.optional(NullableString),
  metadata: Schema.optional(Schema.NullOr(Schema.Unknown)),
  createdAt: Schema.String,
});

export type AuditLogEntry = typeof AuditLogEntry.Type;

export const AuditLogResponse = Schema.Struct({ entries: Schema.Array(AuditLogEntry) });

/**
 * Audit search filters. `cursor` is opaque and may encode a keyset position
 * (`createdAt` + `id`) or a legacy offset; `offset` is accepted for callers
 * that page numerically. Dates are ISO timestamps, inclusive on both ends.
 */
export const AuditSearchQuery = Schema.Struct({
  action: Schema.optional(Schema.String),
  /** Matches actor email or user id (case-insensitive substring). */
  actor: Schema.optional(Schema.String),
  targetType: Schema.optional(Schema.String),
  targetId: Schema.optional(Schema.String),
  from: Schema.optional(Schema.String),
  to: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  cursor: Schema.optional(Schema.String),
  offset: Schema.optional(Schema.Number),
});

export type AuditSearchQuery = typeof AuditSearchQuery.Type;

export const AuditSearchResponse = Schema.Struct({
  entries: Schema.Array(AuditLogEntry),
  nextCursor: Schema.NullOr(Schema.String),
});

export type AuditSearchResponse = typeof AuditSearchResponse.Type;

export const AuditExportQuery = Schema.Struct({
  ...AuditSearchQuery.fields,
  format: Schema.optional(Schema.Literals(["csv", "json"])),
});

export type AuditExportQuery = typeof AuditExportQuery.Type;

export const CreateInvitationResponse = Schema.Struct({
  id: Schema.String,
  /** The one-time acceptance link. Returned once and never persisted in clear. */
  inviteUrl: Schema.String,
  expiresAt: Schema.String,
  emailSent: Schema.Boolean,
});
