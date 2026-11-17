import { Schema } from "effect";
import { NullableString } from "./Errors.js";
import { CredentialLevel } from "./Device.js";

export const ApnsInfo = Schema.Struct({
  configured: Schema.Boolean,
  email: Schema.optional(NullableString),
  topic: Schema.optional(NullableString),
  commonName: Schema.optional(NullableString),
  expiresAt: Schema.optional(NullableString),
  /** Whole days until expiry; zero or negative once expired. */
  daysLeft: Schema.optional(Schema.NullOr(Schema.Number)),
  level: Schema.optional(CredentialLevel),
  /** Whether a private key is stored alongside the certificate. */
  keyConfigured: Schema.optional(Schema.Boolean),
  /** null when there is no stored key to compare against the certificate. */
  keyMatchesCertificate: Schema.optional(Schema.NullOr(Schema.Boolean)),
  /** null when the certificate cannot be parsed. */
  topicMatchesCertificate: Schema.optional(Schema.NullOr(Schema.Boolean)),
  /** Apple Push Certificates Portal: renew here with the same Apple Account. */
  renewalUrl: Schema.optional(Schema.String),
});

export type ApnsInfo = typeof ApnsInfo.Type;

export const ApnsCsrResponse = Schema.Struct({ plist: Schema.String });

export type ApnsCsrResponse = typeof ApnsCsrResponse.Type;

export const UploadApnsRequest = Schema.Struct({ email: Schema.String, cert: Schema.String });
