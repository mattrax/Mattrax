import { Effect, Option, Schema } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { schema as s, type EnterpriseDb } from "@mattrax/enterprise-core";
import {
  resolveEffectivePolicy,
  type EffectivePolicy,
  type PolicyResolutionGroup,
  type PolicyResolutionUser,
  type PolicyResolutionUserGroup,
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

    // A disabled account no longer grants policies. Directory sync disables a
    // leaver instead of deleting the row, so filtering here is what actually
    // stops delivery.
    const users: Array<PolicyResolutionUser> = yield* db
      .select({ id: s.user.id, name: s.user.name, email: s.user.email })
      .from(s.deviceUser)
      .innerJoin(s.user, eq(s.user.id, s.deviceUser.userId))
      .innerJoin(
        s.member,
        and(
          eq(s.member.userId, s.deviceUser.userId),
          eq(s.member.organizationId, device.organizationId),
        ),
      )
      .where(and(eq(s.deviceUser.deviceId, device.id), eq(s.user.disabled, false)));

    const userIds = unique(users.map((user) => user.id));

    const userGroupMembers = userIds.length
      ? yield* db
          .select({ groupId: s.userGroupMember.groupId, userId: s.userGroupMember.userId })
          .from(s.userGroupMember)
          .where(inArray(s.userGroupMember.userId, userIds))
      : [];

    const userGroupIds = unique(userGroupMembers.map((row) => row.groupId));

    const userGroups: Array<PolicyResolutionUserGroup> = userGroupIds.length
      ? yield* db
          .select({ id: s.userGroup.id, name: s.userGroup.name })
          .from(s.userGroup)
          .where(
            and(
              eq(s.userGroup.organizationId, device.organizationId),
              inArray(s.userGroup.id, userGroupIds),
            ),
          )
      : [];

    const userAssignments = userIds.length
      ? yield* db
          .select()
          .from(s.userPolicy)
          .where(
            and(
              eq(s.userPolicy.organizationId, device.organizationId),
              inArray(s.userPolicy.userId, userIds),
            ),
          )
      : [];

    const userGroupAssignments = userGroupIds.length
      ? yield* db
          .select()
          .from(s.userGroupPolicy)
          .where(
            and(
              eq(s.userGroupPolicy.organizationId, device.organizationId),
              inArray(s.userGroupPolicy.groupId, userGroupIds),
            ),
          )
      : [];

    const policyIds = unique([
      ...groupAssignments.map((assignment) => assignment.policyId),
      ...deviceAssignments.map((assignment) => assignment.policyId),
      ...userAssignments.map((assignment) => assignment.policyId),
      ...userGroupAssignments.map((assignment) => assignment.policyId),
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

    const configurationRows = knownPolicyIds.size
      ? yield* db
          .select()
          .from(s.configuration)
          .where(inArray(s.configuration.policyId, [...knownPolicyIds]))
      : [];

    const configurations = configurationRows.flatMap((row) => {
      const data = Schema.decodeUnknownOption(Schema.Json)(row.data);

      return Option.isSome(data) ? [{ ...row, data: data.value }] : [];
    });

    return resolveEffectivePolicy({
      deviceId: device.id,
      groups,
      groupAssignments: groupAssignments.filter((assignment) =>
        knownPolicyIds.has(assignment.policyId),
      ),
      deviceAssignments: deviceAssignments.filter((assignment) =>
        knownPolicyIds.has(assignment.policyId),
      ),
      users,
      userGroups,
      userGroupMembers,
      userAssignments: userAssignments.filter((assignment) =>
        knownPolicyIds.has(assignment.policyId),
      ),
      userGroupAssignments: userGroupAssignments.filter((assignment) =>
        knownPolicyIds.has(assignment.policyId),
      ),
      policies,
      configurations,
    });
  });
