import { Schema } from "effect";
import { NullableString } from "./Errors.js";

/**
 * The facts the overview's "Get started" checklist renders.
 *
 * Steps are derived from these counts on the client rather than stored as a
 * list of completed flags, so the checklist cannot claim a step is done when
 * the underlying resource has been deleted. The response is intentionally
 * small: the overview adds at most one request, and every field below is a
 * tenant-scoped aggregate rather than a per-row read.
 */
export const TenantOnboardingState = Schema.Struct({
  /** When this member dismissed the checklist; null when it is still visible. */
  dismissedAt: NullableString,
  /** Device groups that exist in the tenant. */
  groups: Schema.Number,
  /** Policies that exist in the tenant. */
  policies: Schema.Number,
  /** Policies with at least one assignment (group, device, user or user group). */
  assignedPolicies: Schema.Number,
  /** Devices with an active enrollment. */
  devices: Schema.Number,
  /** Members of the tenant, including the caller. */
  administrators: Schema.Number,
  /** Invitations that have neither been accepted nor expired. */
  pendingInvitations: Schema.Number,
  /** Stable target for the assign step; null until a policy exists. */
  firstPolicyId: NullableString,
});

export type TenantOnboardingState = typeof TenantOnboardingState.Type;

/**
 * Dismissal is per member and tenant. `false` restores the checklist, which
 * keeps the stored preference reversible without a second endpoint.
 */
export const PatchTenantOnboardingRequest = Schema.Struct({
  dismissed: Schema.Boolean,
});

export type PatchTenantOnboardingRequest = typeof PatchTenantOnboardingRequest.Type;
