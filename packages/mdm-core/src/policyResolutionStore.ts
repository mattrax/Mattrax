import { Effect, Option, Schema } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { schema as s } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { containsPolicyVariables, substitutePolicyVariables } from "@mattrax/enterprise-domain";
import type { PolicyVariableContext } from "@mattrax/enterprise-domain";
import { policyDataHashEffect } from "./policyHash.ts";
import { resolveEffectivePolicy } from "./policyResolution.ts";
import type {
  EffectivePolicy,
  PolicyResolutionGroup,
  PolicyResolutionUser,
  PolicyResolutionUserGroup,
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
export const loadPolicyResolutionInput = (
  db: EnterpriseDb,
  device: { readonly id: string; readonly organizationId: string },
): Effect.Effect<Parameters<typeof resolveEffectivePolicy>[0], unknown> =>
  Effect.gen(function* () {
    // Explicit exclusions are filtered here as well as at write time, so a row
    // that somehow survived a membership write still cannot deliver policy.
    // Group ids are resolved through the tenant so a stale edge is inert.
    const rawGroupLinks = yield* db
      .select()
      .from(s.groupDevice)
      .where(eq(s.groupDevice.deviceId, device.id));

    const exclusionRows = yield* db
      .select({ groupId: s.groupExclusion.groupId })
      .from(s.groupExclusion)
      .innerJoin(s.enterpriseGroup, eq(s.enterpriseGroup.id, s.groupExclusion.groupId))
      .where(
        and(
          eq(s.enterpriseGroup.organizationId, device.organizationId),
          eq(s.groupExclusion.target, "device"),
          eq(s.groupExclusion.targetId, device.id),
        ),
      );

    const excludedGroupIds = new Set(exclusionRows.map((row) => row.groupId));

    const groupLinks = rawGroupLinks.filter((link) => !excludedGroupIds.has(link.groupId));

    const groupIds = unique(groupLinks.map((link) => link.groupId));

    const groupUserExclusions = groupIds.length
      ? yield* db
          .select({
            groupId: s.groupExclusion.groupId,
            userId: s.groupExclusion.targetId,
          })
          .from(s.groupExclusion)
          .where(
            and(eq(s.groupExclusion.target, "user"), inArray(s.groupExclusion.groupId, groupIds)),
          )
      : [];

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

    // Linked directory users drive user-scoped policy. A disabled directory
    // user stops granting policies; directory sync disables a leaver instead of
    // deleting the row, so filtering here is what actually stops delivery. The
    // user must belong to this device's tenant.
    const users: Array<PolicyResolutionUser> = yield* db
      .select({ id: s.user.id, name: s.user.name, email: s.user.email })
      .from(s.deviceUser)
      .innerJoin(s.user, eq(s.user.id, s.deviceUser.userId))
      .where(
        and(
          eq(s.deviceUser.deviceId, device.id),
          eq(s.user.organizationId, device.organizationId),
          eq(s.user.disabled, false),
        ),
      );

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

    // Variables are resolved per device at compile time. The extra reads only
    // happen when a payload actually references one, so fleets without
    // variables pay nothing.
    const needsVariables = configurations.some(
      (configuration) =>
        configuration.data !== undefined && containsPolicyVariables(configuration.data),
    );

    const [deviceRow] = needsVariables
      ? yield* db
          .select({
            name: s.device.name,
            serial: s.device.serial,
            model: s.device.model,
          })
          .from(s.device)
          .where(
            and(eq(s.device.id, device.id), eq(s.device.organizationId, device.organizationId)),
          )
          .limit(1)
      : [];

    const [organization] = needsVariables
      ? yield* db
          .select({ name: s.organization.name })
          .from(s.organization)
          .where(eq(s.organization.id, device.organizationId))
          .limit(1)
      : [];

    const attributeRows = needsVariables
      ? yield* db
          .select({ key: s.attributeDefinition.key, value: s.deviceAttribute.value })
          .from(s.deviceAttribute)
          .innerJoin(
            s.attributeDefinition,
            eq(s.attributeDefinition.id, s.deviceAttribute.attributeId),
          )
          .where(
            and(
              eq(s.deviceAttribute.organizationId, device.organizationId),
              eq(s.deviceAttribute.deviceId, device.id),
            ),
          )
      : [];

    const variableContext: PolicyVariableContext = {
      device: deviceRow ?? null,
      tenant: organization ?? null,
      attributes: Object.fromEntries(attributeRows.map((row) => [row.key, row.value])),
    };

    const resolvedConfigurations = yield* Effect.forEach(configurations, (configuration) => {
      if (configuration.data === undefined || !containsPolicyVariables(configuration.data))
        return Effect.succeed(configuration);

      const data = substitutePolicyVariables(configuration.data, variableContext);

      // The resolved text is what the device receives, so the declaration
      // server token must change when an attribute value changes.
      return policyDataHashEffect(data).pipe(
        Effect.map((hash) => ({ ...configuration, data, hash })),
      );
    });

    return {
      deviceId: device.id,
      groups,
      groupAssignments: groupAssignments.filter((assignment) =>
        knownPolicyIds.has(assignment.policyId),
      ),
      deviceAssignments: deviceAssignments.filter((assignment) =>
        knownPolicyIds.has(assignment.policyId),
      ),
      groupUserExclusions: groupUserExclusions.map((row) => ({
        groupId: row.groupId,
        userId: row.userId,
      })),
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
      configurations: resolvedConfigurations,
    };
  });

/**
 * The device channel: device-scoped configurations, applied to every user.
 *
 * `includeUserScoped` is for platforms with no per-login channel (Windows). It
 * adds user-scoped configurations to the device check-in, where they apply to
 * every user. Apple never sets it: user scope belongs on the user channel.
 */
export const resolveEffectivePolicyForDevice = (
  db: EnterpriseDb,
  device: { readonly id: string; readonly organizationId: string },
  options: { readonly includeUserScoped?: boolean } = {},
): Effect.Effect<EffectivePolicy, unknown> =>
  loadPolicyResolutionInput(db, device).pipe(
    Effect.map((input) =>
      resolveEffectivePolicy({
        ...input,
        ...(options.includeUserScoped ? { includeUserScoped: true } : {}),
      }),
    ),
  );

/**
 * One authenticated user channel: user-scoped configurations only.
 *
 * Device and group assignments contribute their user-scoped configurations to
 * every user; `userId` contributes its direct and directory-group assignments.
 * Device scope still beats user scope when both provide the same kind.
 */
export const resolveEffectivePolicyForUser = (
  db: EnterpriseDb,
  device: { readonly id: string; readonly organizationId: string },
  userId: string,
): Effect.Effect<EffectivePolicy, unknown> =>
  loadPolicyResolutionInput(db, device).pipe(
    Effect.map((input) => resolveEffectivePolicy({ ...input, channel: "user", forUserId: userId })),
  );
