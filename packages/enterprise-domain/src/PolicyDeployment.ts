import { Schema } from "effect";
import { PolicyDeliveryState } from "./Policy.js";

/**
 * Per-device progress for one saved policy version.
 *
 * The policy deployment snapshot records what a version contained, but the
 * server only has per-device delivery evidence for some channels. This
 * contract is deliberately narrower than "deployed": a device is `delivered`
 * only when its own declaration report proves the version arrived, and a device
 * that cannot report is `untracked` instead of being counted as reached.
 *
 * - `pending`: a declarative Apple device in scope that has not reported every
 *   kind of this version yet.
 * - `delivered`: every kind this version targets on the device is reported
 *   valid, active and for the current content.
 * - `failed`: the device currently reports an invalid or failed declaration.
 * - `not-applicable`: this version has no kind the device should receive,
 *   either because another policy wins every kind or because nothing is
 *   device-scoped (a user-channel-only policy).
 * - `untracked`: the platform does not report DDM declaration status
 *   (Windows, Android, or an Apple device on the legacy profile path).
 * - `not-in-scope`: the device still reports this policy's declarations but
 *   the current assignment scope no longer includes it.
 */
export const PolicyDeploymentDeviceStatus = Schema.Literals([
  "pending",
  "delivered",
  "failed",
  "not-applicable",
  "untracked",
  "not-in-scope",
]);

export type PolicyDeploymentDeviceStatus = typeof PolicyDeploymentDeviceStatus.Type;

export const PolicyDeploymentPlatform = Schema.Literals(["apple", "windows", "android"]);

export type PolicyDeploymentPlatform = typeof PolicyDeploymentPlatform.Type;

export const PolicyDeploymentDevice = Schema.Struct({
  deviceId: Schema.String,
  name: Schema.String,
  platform: PolicyDeploymentPlatform,
  status: PolicyDeploymentDeviceStatus,
  /** Configuration kinds this version targets on the device. */
  applicableKinds: Schema.Number,
  /** Kinds the device currently reports as delivered for this version. */
  deliveredKinds: Schema.Number,
  /**
   * When the newest evidence for this version was recorded. Declaration
   * reports use their report time; a legacy Apple device may carry the time of
   * its last profile install command. Null when nothing has reported.
   */
  lastEvidenceAt: Schema.NullOr(Schema.String),
  /** One short sentence explaining the status, safe to show to an operator. */
  reason: Schema.String,
});

export type PolicyDeploymentDevice = typeof PolicyDeploymentDevice.Type;

/**
 * Counts over every device the progress view considered. `total` includes
 * devices outside the current scope that still hold evidence for this policy;
 * `scoped` is the subset the policy targets now. The remaining fields sum to
 * `total`.
 */
export const PolicyDeploymentCounts = Schema.Struct({
  total: Schema.Number,
  scoped: Schema.Number,
  delivered: Schema.Number,
  pending: Schema.Number,
  failed: Schema.Number,
  notApplicable: Schema.Number,
  untracked: Schema.Number,
  notInScope: Schema.Number,
});

export type PolicyDeploymentCounts = typeof PolicyDeploymentCounts.Type;

export const PolicyDeploymentProgressResponse = Schema.Struct({
  policyId: Schema.String,
  version: Schema.Number,
  /** When this version was saved, or null if the row was removed. */
  createdAt: Schema.NullOr(Schema.String),
  createdByAccountId: Schema.NullOr(Schema.String),
  /** The same rollup state the policy list reports for this version. */
  state: PolicyDeliveryState,
  counts: PolicyDeploymentCounts,
  /** One bounded page of devices, action-needed first. */
  devices: Schema.Array(PolicyDeploymentDevice),
  /** Offset of `devices[0]` in the complete ordered set. */
  offset: Schema.Number,
  /** Offset for the next page, or null on the last page. */
  nextOffset: Schema.NullOr(Schema.Number),
});

export type PolicyDeploymentProgressResponse = typeof PolicyDeploymentProgressResponse.Type;
