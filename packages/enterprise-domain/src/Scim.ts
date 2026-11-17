import { Schema } from "effect";
import { NullableString } from "./Errors.js";

export const ScimTokenInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  createdAt: Schema.String,
  lastUsedAt: Schema.optional(NullableString),
  /** When the bearer token stops authenticating; null only for legacy rows. */
  expiresAt: Schema.optional(NullableString),
  /**
   * True when the token is expired or inside the 14-day rotation window. The
   * dashboard surfaces this so an IdP credential is rotated before it breaks
   * provisioning.
   */
  rotationDue: Schema.Boolean,
});

export const ScimTokensResponse = Schema.Struct({ tokens: Schema.Array(ScimTokenInfo) });

export const CreateScimTokenRequest = Schema.Struct({
  name: Schema.String,
  /**
   * Absolute ISO-8601 expiry. Omitted means 90 days; the API refuses a date in
   * the past or more than 365 days ahead.
   */
  expiresAt: Schema.optional(NullableString),
});

export const CreateScimTokenResponse = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  token: Schema.String,
  baseUrl: Schema.String,
  expiresAt: Schema.optional(NullableString),
});
