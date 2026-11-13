import { Effect } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { schema as s, type EnterpriseDb } from "@mattrax/enterprise-core";
import {
  resolveEffectivePolicy,
  type EffectivePolicy,
  type PolicyResolutionGroup,
} from "./policyResolution.ts";

const unique = (values: Iterable<string>) => [...new Set(values)];

/**
 * Load every assignment that can affect a device, then run the pure resolver.
 *
 * The queries are deliberately separate (rather than one join) because group
 * exclusions, direct exclusions and direct includes need to stay distinguishable
 * in the result. Tenant scoping is applied to the device by the caller and to
 * groups/policies here, so a malformed cross-tenant row cannot leak a policy.
 */
export const resolveEffectivePolicyForDevice = (
  db: EnterpriseDb,
  device: { readonly id: string; readonly organizationId: string },
): Effect.Effect<EffectivePolicy, unknown> =>
  Effect.gen(function* () {
    const groupLinks = yield* db
      .select()
      .from(s.groupDevice)
      .where(eq(s.groupDevice.deviceId, device.id));

    const groupIds = unique(groupLinks.map((link) => link.groupId));

    const groups: Array<PolicyResolutionGroup> = groupIds.length
      ? yield* db
          .select()
          .from(s.enterpriseGroup)
          .where(
            and(
              eq(s.enterpriseGroup.organizationId, device.organizationId),
              inArray(s.enterpriseGroup.id, groupIds),
            ),
          )
      : [];

    const groupAssignments = groupIds.length
      ? yield* db.select().from(s.groupPolicy).where(inArray(s.groupPolicy.groupId, groupIds))
      : [];

    const deviceAssignments = yield* db
      .select()
      .from(s.devicePolicy)
      .where(eq(s.devicePolicy.deviceId, device.id));

    const policyIds = unique([
      ...groupAssignments.map((assignment) => assignment.policyId),
      ...deviceAssignments.map((assignment) => assignment.policyId),
    ]);

    const policies = policyIds.length
      ? yield* db
          .select()
          .from(s.policy)
          .where(
            and(
              eq(s.policy.organizationId, device.organizationId),
              inArray(s.policy.id, policyIds),
            ),
          )
      : [];

    const knownPolicyIds = new Set(policies.map((policy) => policy.id));

    const configurations = knownPolicyIds.size
      ? yield* db
          .select()
          .from(s.configuration)
          .where(inArray(s.configuration.policyId, [...knownPolicyIds]))
      : [];

    return resolveEffectivePolicy({
      deviceId: device.id,
      groups,
      groupAssignments: groupAssignments.filter((assignment) =>
        knownPolicyIds.has(assignment.policyId),
      ),
      deviceAssignments: deviceAssignments.filter((assignment) =>
        knownPolicyIds.has(assignment.policyId),
      ),
      policies,
      configurations,
    });
  });
