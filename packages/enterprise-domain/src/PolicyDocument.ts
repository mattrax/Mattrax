import { Schema } from "effect";
import { JsonRecord, NullableString } from "./Errors.js";
import { ConfigurationScope } from "./Policy.js";

/**
 * The portable policy document. It is the interchange format between
 * deployments: `mattrax policies export` writes it, `mattrax policies apply`
 * reads it, and the dashboard's policy import reads it too.
 *
 * One document may hold several policies. An import into an existing policy
 * needs exactly one, because it merges configurations into that policy.
 */
export const PORTABLE_POLICY_VERSION = 1;

export const PortablePolicy = Schema.Struct({
  /** Server id for in-place updates on the same deployment. */
  id: Schema.optional(Schema.String),
  name: Schema.String,
  notes: Schema.optional(NullableString),
  priority: Schema.optional(Schema.Number),
  /** Absent means enabled, so documents written before the flag import enabled. */
  enabled: Schema.optional(Schema.Boolean),
  /** Configuration kind (for example `mttx.apple.device`) mapped to its payload. */
  configurations: Schema.optional(JsonRecord),
  /** Delivery channel per configuration kind; missing entries are device scope. */
  configurationScopes: Schema.optional(Schema.Record(Schema.String, ConfigurationScope)),
});

export type PortablePolicy = typeof PortablePolicy.Type;

export const PortablePolicyDocument = Schema.Struct({
  version: Schema.Literal(PORTABLE_POLICY_VERSION),
  policies: Schema.Array(PortablePolicy),
});

export type PortablePolicyDocument = typeof PortablePolicyDocument.Type;
