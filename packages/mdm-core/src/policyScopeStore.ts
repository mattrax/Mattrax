import { Effect, Option, Schema } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { schema as s, type EnterpriseDb } from "@mattrax/enterprise-core";
import type { PolicyResolutionConfiguration } from "./policyResolution.ts";
import type { PolicyScopeResolutionInput } from "./policyScope.ts";

/**
 * Load the tenant-wide assignment graph one scope question needs.
 *
 * A policy page asks "which devices does this policy reach", and a group page
 * asks "which devices do this group's policies actually win on". Both are the
 * reverse of the per-device resolver, so they need more than one device's
 * slice: every candidate device's groups, linked users and assignments. The
 * loader reads those in a fixed number of bulk queries and only loads devices
 * that an assignment edge can reach, so an unrelated fleet does not get
 * resolved.
 */

export type PolicyScopeStoreTarget = { readonly policyId: string } | { readonly groupId: string };

const unique = (values: Iterable<string>) => [...new Set(values)];

export const loadPolicyScopeResolutionInput = (
  db: EnterpriseDb,
  organizationId: string,
  target: PolicyScopeStoreTarget,
): Effect.Effect<PolicyScopeResolutionInput, unknown> =>
  Effect.gen(function* () {
    const policyRows = yield* db
      .select()
      .from(s.policy)
      .where(eq(s.policy.organizationId, organizationId));

    const groupRows = yield* db
      .select()
      .from(s.enterpriseGroup)
      .where(eq(s.enterpriseGroup.organizationId, organizationId));

    const userGroupRows = yield* db
      .select()
      .from(s.userGroup)
      .where(eq(s.userGroup.organizationId, organizationId));

    const policyIds = new Set(policyRows.map((row) => row.id));
    const groupIds = new Set(groupRows.map((row) => row.id));
    const userGroupIds = new Set(userGroupRows.map((row) => row.id));

    const groupAssignmentRows = groupIds.size
      ? yield* db
          .select()
          .from(s.groupPolicy)
          .where(inArray(s.groupPolicy.groupId, [...groupIds]))
      : [];

    const groupAssignments = groupAssignmentRows
      .filter((row) => policyIds.has(row.policyId))
      .map((row) => ({
        groupId: row.groupId,
        policyId: row.policyId,
        mode: row.mode ?? "include",
      }));

    const userAssignmentRows = yield* db
      .select()
      .from(s.userPolicy)
      .where(eq(s.userPolicy.organizationId, organizationId));

    const userGroupAssignmentRows = userGroupIds.size
      ? yield* db
          .select()
          .from(s.userGroupPolicy)
          .where(
            and(
              eq(s.userGroupPolicy.organizationId, organizationId),
              inArray(s.userGroupPolicy.groupId, [...userGroupIds]),
            ),
          )
      : [];

    const userAssignments = userAssignmentRows
      .filter((row) => policyIds.has(row.policyId))
      .map((row) => ({
        userId: row.userId,
        policyId: row.policyId,
        mode: row.mode ?? "include",
      }));

    const userGroupAssignments = userGroupAssignmentRows
      .filter((row) => policyIds.has(row.policyId))
      .map((row) => ({
        groupId: row.groupId,
        policyId: row.policyId,
        mode: row.mode ?? "include",
      }));

    const deviceAssignmentRows =
      "policyId" in target
        ? (yield* db
            .select()
            .from(s.devicePolicy)
            .where(eq(s.devicePolicy.policyId, target.policyId))).filter((row) =>
            policyIds.has(row.policyId),
          )
        : [];

    // Candidate devices are exactly the ones an assignment edge can reach. An
    // exclusion is a candidate too: the page has to explain the device it
    // loses on, not silently omit it.
    let candidateDeviceIds: Array<string> = [];

    if ("groupId" in target) {
      candidateDeviceIds = groupIds.has(target.groupId)
        ? unique(
            (yield* db
              .select()
              .from(s.groupDevice)
              .where(eq(s.groupDevice.groupId, target.groupId))).map((row) => row.deviceId),
          )
        : [];
    } else {
      const policyGroupIds = unique(
        groupAssignments
          .filter((assignment) => assignment.policyId === target.policyId)
          .map((assignment) => assignment.groupId),
      );

      const policyUserGroupIds = unique(
        userGroupAssignments
          .filter((assignment) => assignment.policyId === target.policyId)
          .map((assignment) => assignment.groupId),
      );

      const candidateUserIds = unique([
        ...userAssignments
          .filter((assignment) => assignment.policyId === target.policyId)
          .map((assignment) => assignment.userId),
        ...(policyUserGroupIds.length
          ? (yield* db
              .select()
              .from(s.userGroupMember)
              .where(inArray(s.userGroupMember.groupId, policyUserGroupIds))).map(
              (row) => row.userId,
            )
          : []),
      ]);

      const groupMembers = policyGroupIds.length
        ? yield* db
            .select()
            .from(s.groupDevice)
            .where(inArray(s.groupDevice.groupId, policyGroupIds))
        : [];

      const userLinks = candidateUserIds.length
        ? yield* db
            .select()
            .from(s.deviceUser)
            .where(
              and(
                eq(s.deviceUser.organizationId, organizationId),
                inArray(s.deviceUser.userId, candidateUserIds),
              ),
            )
        : [];

      candidateDeviceIds = unique([
        ...deviceAssignmentRows.map((row) => row.deviceId),
        ...groupMembers.map((row) => row.deviceId),
        ...userLinks.map((row) => row.deviceId),
      ]);
    }

    const devices = candidateDeviceIds.length
      ? yield* db
          .select({
            id: s.device.id,
            name: s.device.name,
            proto: s.device.proto,
            osEdition: s.device.osEdition,
            osVersion: s.device.osVersion,
            osBuild: s.device.osBuild,
            declarationMode: s.deviceApple.declarationMode,
          })
          .from(s.device)
          .leftJoin(s.deviceApple, eq(s.deviceApple.deviceId, s.device.id))
          .where(
            and(
              eq(s.device.organizationId, organizationId),
              inArray(s.device.id, candidateDeviceIds),
            ),
          )
      : [];

    const deviceIds = devices.map((device) => device.id);

    const deviceUserRows = deviceIds.length
      ? yield* db
          .select()
          .from(s.deviceUser)
          .where(
            and(
              eq(s.deviceUser.organizationId, organizationId),
              inArray(s.deviceUser.deviceId, deviceIds),
            ),
          )
      : [];

    const deviceGroupLinks = deviceIds.length
      ? yield* db.select().from(s.groupDevice).where(inArray(s.groupDevice.deviceId, deviceIds))
      : [];

    const allGroupAssignments = deviceIds.length
      ? yield* db.select().from(s.devicePolicy).where(inArray(s.devicePolicy.deviceId, deviceIds))
      : [];

    const linkedUserIds = unique(deviceUserRows.map((row) => row.userId));

    const users = linkedUserIds.length
      ? yield* db
          .select({ id: s.user.id, name: s.user.name, email: s.user.email })
          .from(s.user)
          .where(
            and(
              eq(s.user.organizationId, organizationId),
              eq(s.user.disabled, false),
              inArray(s.user.id, linkedUserIds),
            ),
          )
      : [];

    const knownUserIds = new Set(users.map((user) => user.id));

    const memberGroupIds = new Set(
      deviceGroupLinks.map((link) => link.groupId).filter((groupId) => groupIds.has(groupId)),
    );

    const userGroupMemberRows = knownUserIds.size
      ? (yield* db
          .select()
          .from(s.userGroupMember)
          .where(inArray(s.userGroupMember.userId, [...knownUserIds]))).filter((row) =>
          userGroupIds.has(row.groupId),
        )
      : [];

    const configurations = policyIds.size
      ? yield* db
          .select()
          .from(s.configuration)
          .where(inArray(s.configuration.policyId, [...policyIds]))
      : [];

    const decoded = configurations.flatMap((row) => {
      const data = Schema.decodeUnknownOption(Schema.Json)(row.data);

      return Option.isSome(data) ? [{ ...row, data: data.value }] : [];
    });

    // The scope summary uses a configuration's payload for OS support and
    // payload type only. Variable substitution changes values, not support, so
    // the stored template is enough; skipping it also keeps this read from
    // depending on every candidate device's attributes.
    // SAFETY: every row comes from `configuration` and its `data` was decoded
    // above; the remaining resolver fields (`policyId`, `kind`, `scope`, `hash`)
    // are exactly the columns selected, so the row satisfies the resolver type.
    const resolvedConfigurations = decoded as Array<PolicyResolutionConfiguration>;

    return {
      policies: policyRows,
      configurations: resolvedConfigurations,
      devices,
      groups: groupRows.filter((group) => memberGroupIds.has(group.id)),
      groupAssignments: groupAssignments.filter((assignment) =>
        memberGroupIds.has(assignment.groupId),
      ),
      groupMembers: deviceGroupLinks
        .filter((link) => groupIds.has(link.groupId))
        .map((link) => ({ groupId: link.groupId, deviceId: link.deviceId })),
      deviceAssignments: allGroupAssignments
        .filter((row) => policyIds.has(row.policyId))
        .map((row) => ({
          deviceId: row.deviceId,
          policyId: row.policyId,
          mode: row.mode ?? "include",
        })),
      users,
      deviceUsers: deviceUserRows
        .filter((row) => knownUserIds.has(row.userId))
        .map((row) => ({ deviceId: row.deviceId, userId: row.userId })),
      userGroups: userGroupRows,
      userGroupMembers: userGroupMemberRows.map((row) => ({
        groupId: row.groupId,
        userId: row.userId,
      })),
      userAssignments,
      userGroupAssignments,
    };
  });
