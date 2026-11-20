import { Effect, Option, Schema } from "effect";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { schema as s, type EnterpriseDb } from "@mattrax/enterprise-core";
import type { PolicyResolutionConfiguration } from "./policyResolution.ts";
import { MAX_SCOPE_DEVICES, type PolicyScopeResolutionInput } from "./policyScope.ts";

/**
 * Load the tenant-wide assignment graph one scope question needs.
 *
 * A policy page asks "which devices does this policy reach", and a group page
 * asks "which devices do this group's policies actually win on". Both are the
 * reverse of the per-device resolver, so they need more than one device's
 * slice: every candidate device's groups, linked users and assignments. The
 * loader reads those in a fixed number of bulk queries, concurrently where the
 * reads do not depend on each other, and only loads devices that an assignment
 * edge can reach.
 *
 * Devices are capped at `MAX_SCOPE_DEVICES`; the true candidate count and a
 * `truncated` flag travel with the result so the page can say how much it is
 * not showing without the response growing with the fleet.
 */

export type PolicyScopeStoreTarget = { readonly policyId: string } | { readonly groupId: string };

const unique = (values: Iterable<string>) => [...new Set(values)];

const queryEffect = <A, E, R>(builder: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    return yield* builder;
  });

const maybe = <A>(
  condition: boolean,
  load: () => Effect.Effect<Array<A>, unknown>,
): Effect.Effect<Array<A>, unknown> => (condition ? queryEffect(load()) : Effect.succeed([]));

export const loadPolicyScopeResolutionInput = (
  db: EnterpriseDb,
  organizationId: string,
  target: PolicyScopeStoreTarget,
): Effect.Effect<PolicyScopeResolutionInput, unknown> =>
  Effect.gen(function* () {
    const targetPolicyId = "policyId" in target ? target.policyId : "";
    const targetGroupId = "groupId" in target ? target.groupId : "";

    // The first wave only needs the tenant dimensions and the target's own
    // edges; everything else depends on the candidate devices it produces.
    const [
      groupRows,
      userGroupRows,
      targetDeviceAssignments,
      targetGroupMembers,
      targetUserAssignments,
    ] = yield* Effect.all(
      [
        queryEffect(
          db
            .select()
            .from(s.enterpriseGroup)
            .where(eq(s.enterpriseGroup.organizationId, organizationId)),
        ),
        queryEffect(
          db.select().from(s.userGroup).where(eq(s.userGroup.organizationId, organizationId)),
        ),
        maybe(targetPolicyId !== "", () =>
          db.select().from(s.devicePolicy).where(eq(s.devicePolicy.policyId, targetPolicyId)),
        ),
        maybe(targetGroupId !== "", () =>
          db.select().from(s.groupDevice).where(eq(s.groupDevice.groupId, targetGroupId)),
        ),
        maybe(targetPolicyId !== "", () =>
          db
            .select()
            .from(s.userPolicy)
            .where(
              and(
                eq(s.userPolicy.organizationId, organizationId),
                eq(s.userPolicy.policyId, targetPolicyId),
              ),
            ),
        ),
      ],
      { concurrency: "unbounded" },
    );

    const groupIds = new Set(groupRows.map((row) => row.id));
    const userGroupIds = new Set(userGroupRows.map((row) => row.id));

    const [groupAssignmentRows, userGroupAssignmentRows] = yield* Effect.all(
      [
        maybe(groupIds.size > 0, () =>
          db
            .select()
            .from(s.groupPolicy)
            .where(inArray(s.groupPolicy.groupId, [...groupIds])),
        ),
        maybe(userGroupIds.size > 0, () =>
          db
            .select()
            .from(s.userGroupPolicy)
            .where(
              and(
                eq(s.userGroupPolicy.organizationId, organizationId),
                inArray(s.userGroupPolicy.groupId, [...userGroupIds]),
              ),
            ),
        ),
      ],
      { concurrency: "unbounded" },
    );

    const groupAssignments = groupAssignmentRows
      .filter((row) => groupIds.has(row.groupId))
      .map((row) => ({
        groupId: row.groupId,
        policyId: row.policyId,
        mode: row.mode ?? "include",
      }));

    const userGroupAssignments = userGroupAssignmentRows
      .filter((row) => userGroupIds.has(row.groupId))
      .map((row) => ({
        groupId: row.groupId,
        policyId: row.policyId,
        mode: row.mode ?? "include",
      }));

    // Candidate devices are exactly the ones an assignment edge can reach. An
    // exclusion is a candidate too: the page has to explain the device it
    // loses on, not silently omit it.
    // A device excluded from the target group is not one of its members, even
    // when a materialised row survived. The same filter is applied to policy
    // candidates below through the membership rows.
    const targetGroupDeviceExclusions =
      targetGroupId !== ""
        ? yield* db
            .select({ targetId: s.groupExclusion.targetId })
            .from(s.groupExclusion)
            .where(
              and(
                eq(s.groupExclusion.groupId, targetGroupId),
                eq(s.groupExclusion.target, "device"),
              ),
            )
        : [];

    const excludedFromTargetGroup = new Set(
      targetGroupDeviceExclusions.map((row) => row.targetId),
    );

    let candidateDeviceIds: Array<string> = [];

    if (targetGroupId !== "") {
      candidateDeviceIds = unique(targetGroupMembers.map((row) => row.deviceId)).filter(
        (deviceId) => !excludedFromTargetGroup.has(deviceId),
      );
    } else {
      const policyGroupIds = unique(
        groupAssignments
          .filter((assignment) => assignment.policyId === targetPolicyId)
          .map((assignment) => assignment.groupId),
      );

      const policyUserGroupIds = unique(
        userGroupAssignments
          .filter((assignment) => assignment.policyId === targetPolicyId)
          .map((assignment) => assignment.groupId),
      );

      const [groupMembers, userGroupMembers] = yield* Effect.all(
        [
          maybe(policyGroupIds.length > 0, () =>
            db.select().from(s.groupDevice).where(inArray(s.groupDevice.groupId, policyGroupIds)),
          ),
          maybe(policyUserGroupIds.length > 0, () =>
            db
              .select()
              .from(s.userGroupMember)
              .where(inArray(s.userGroupMember.groupId, policyUserGroupIds)),
          ),
        ],
        { concurrency: "unbounded" },
      );

      const candidateUserIds = unique([
        ...targetUserAssignments.map((row) => row.userId),
        ...userGroupMembers.map((row) => row.userId),
      ]);

      const [userLinks, appleChannelLinks] = yield* Effect.all(
        [
          maybe(candidateUserIds.length > 0, () =>
            db
              .select()
              .from(s.deviceUser)
              .where(
                and(
                  eq(s.deviceUser.organizationId, organizationId),
                  inArray(s.deviceUser.userId, candidateUserIds),
                ),
              ),
          ),
          maybe(candidateUserIds.length > 0, () =>
            db
              .select({ deviceId: s.deviceAppleUser.deviceId })
              .from(s.deviceAppleUser)
              .where(
                and(
                  inArray(s.deviceAppleUser.directoryUserId, candidateUserIds),
                  isNotNull(s.deviceAppleUser.identityVerifiedAt),
                ),
              ),
          ),
        ],
        { concurrency: "unbounded" },
      );

      candidateDeviceIds = unique([
        ...targetDeviceAssignments.map((row) => row.deviceId),
        ...groupMembers.map((row) => row.deviceId),
        ...userLinks.map((row) => row.deviceId),
        ...appleChannelLinks.map((row) => row.deviceId),
      ]);
    }

    candidateDeviceIds.sort();

    const deviceCount = candidateDeviceIds.length;
    const truncated = deviceCount > MAX_SCOPE_DEVICES;
    const deviceIds = candidateDeviceIds.slice(0, MAX_SCOPE_DEVICES);

    const devices = deviceIds.length
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
          .where(and(eq(s.device.organizationId, organizationId), inArray(s.device.id, deviceIds)))
      : [];

    const loadedDeviceIds = devices.map((device) => device.id);

    const [
      deviceUserRows,
      rawDeviceGroupLinks,
      deviceAssignmentRows,
      appleUserChannelRows,
      deviceExclusionRows,
    ] = yield* Effect.all(
        [
          maybe(loadedDeviceIds.length > 0, () =>
            db
              .select()
              .from(s.deviceUser)
              .where(
                and(
                  eq(s.deviceUser.organizationId, organizationId),
                  inArray(s.deviceUser.deviceId, loadedDeviceIds),
                ),
              ),
          ),
          maybe(loadedDeviceIds.length > 0, () =>
            db.select().from(s.groupDevice).where(inArray(s.groupDevice.deviceId, loadedDeviceIds)),
          ),
          maybe(loadedDeviceIds.length > 0, () =>
            db
              .select()
              .from(s.devicePolicy)
              .where(inArray(s.devicePolicy.deviceId, loadedDeviceIds)),
          ),
          maybe(loadedDeviceIds.length > 0, () =>
            db
              .select({
                deviceId: s.deviceAppleUser.deviceId,
                directoryUserId: s.deviceAppleUser.directoryUserId,
                userLongName: s.deviceAppleUser.userLongName,
                userShortName: s.deviceAppleUser.userShortName,
              })
              .from(s.deviceAppleUser)
              .where(
                and(
                  inArray(s.deviceAppleUser.deviceId, loadedDeviceIds),
                  isNotNull(s.deviceAppleUser.directoryUserId),
                  isNotNull(s.deviceAppleUser.identityVerifiedAt),
                ),
              ),
          ),
          maybe(loadedDeviceIds.length > 0, () =>
            db
              .select({
                groupId: s.groupExclusion.groupId,
                targetId: s.groupExclusion.targetId,
              })
              .from(s.groupExclusion)
              .where(
                and(
                  eq(s.groupExclusion.target, "device"),
                  inArray(s.groupExclusion.targetId, loadedDeviceIds),
                ),
              ),
          ),
        ],
        { concurrency: "unbounded" },
      );

    // A device exclusion removes the device from that group. Filter at read
    // time too so a row that outlived a membership write cannot grant policy.
    const excludedDeviceGroups = new Set(
      deviceExclusionRows.map((row) => `${row.groupId}:${row.targetId}`),
    );

    const deviceGroupLinks = rawDeviceGroupLinks.filter(
      (link) => !excludedDeviceGroups.has(`${link.groupId}:${link.deviceId}`),
    );

    const deviceById = new Map(devices.map((device) => [device.id, device]));
    const deviceUserIdsByDevice = new Map<string, Array<string>>();

    for (const link of deviceUserRows) {
      const list = deviceUserIdsByDevice.get(link.deviceId) ?? [];

      list.push(link.userId);
      deviceUserIdsByDevice.set(link.deviceId, list);
    }

    // Only a verified, DDM-bound Apple user channel receives user-scoped
    // policy. Enumerating `device_user` instead would report settings that no
    // channel can deliver.
    const appleUserIdsByDevice = new Map<string, Array<string>>();

    for (const channel of appleUserChannelRows) {
      const device = deviceById.get(channel.deviceId);

      if (!device || device.proto !== "apple" || device.declarationMode !== "ddm") continue;

      if (!channel.directoryUserId) continue;
      const list = appleUserIdsByDevice.get(channel.deviceId) ?? [];

      if (!list.includes(channel.directoryUserId)) list.push(channel.directoryUserId);
      appleUserIdsByDevice.set(channel.deviceId, list);
    }

    const userLinks = devices.flatMap((device) => {
      const userIds =
        device.proto === "apple"
          ? (appleUserIdsByDevice.get(device.id) ?? [])
          : (deviceUserIdsByDevice.get(device.id) ?? []);

      return unique(userIds).map((userId) => ({ deviceId: device.id, userId }));
    });

    const linkedUserIds = unique(userLinks.map((link) => link.userId));

    const [users, userGroupMemberRows, userPolicyRows] = yield* Effect.all(
      [
        maybe(linkedUserIds.length > 0, () =>
          db
            .select({ id: s.user.id, name: s.user.name, email: s.user.email })
            .from(s.user)
            .where(
              and(
                eq(s.user.organizationId, organizationId),
                eq(s.user.disabled, false),
                inArray(s.user.id, linkedUserIds),
              ),
            ),
        ),
        maybe(linkedUserIds.length > 0, () =>
          db
            .select()
            .from(s.userGroupMember)
            .where(inArray(s.userGroupMember.userId, linkedUserIds)),
        ),
        maybe(linkedUserIds.length > 0, () =>
          db
            .select()
            .from(s.userPolicy)
            .where(
              and(
                eq(s.userPolicy.organizationId, organizationId),
                inArray(s.userPolicy.userId, linkedUserIds),
              ),
            ),
        ),
      ],
      { concurrency: "unbounded" },
    );

    const knownUserIds = new Set(users.map((user) => user.id));

    const memberGroupIds = new Set(
      deviceGroupLinks.map((link) => link.groupId).filter((groupId) => groupIds.has(groupId)),
    );

    const linkedUserGroupIds = new Set(
      userGroupMemberRows
        .filter((row) => knownUserIds.has(row.userId))
        .map((row) => row.groupId)
        .filter((groupId) => userGroupIds.has(groupId)),
    );

    const userGroupMemberRowsForKnownUsers = userGroupMemberRows.filter(
      (row) => knownUserIds.has(row.userId) && userGroupIds.has(row.groupId),
    );

    // Restrict policies and configurations to the assignment graph this page
    // resolves. Loading the whole tenant's settings would dominate the request
    // for a policy with a handful of devices.
    const relevantPolicyIds = new Set<string>();

    if (targetPolicyId !== "") relevantPolicyIds.add(targetPolicyId);

    for (const assignment of groupAssignments) {
      if (assignment.groupId === targetGroupId) relevantPolicyIds.add(assignment.policyId);

      if (memberGroupIds.has(assignment.groupId)) relevantPolicyIds.add(assignment.policyId);
    }

    for (const assignment of deviceAssignmentRows) relevantPolicyIds.add(assignment.policyId);

    for (const assignment of userPolicyRows) relevantPolicyIds.add(assignment.policyId);

    for (const assignment of userGroupAssignments)
      if (linkedUserGroupIds.has(assignment.groupId)) relevantPolicyIds.add(assignment.policyId);

    const relevantPolicies = [...relevantPolicyIds];

    const [policyRows, configurationRows] = yield* Effect.all(
      [
        maybe(relevantPolicies.length > 0, () =>
          db
            .select()
            .from(s.policy)
            .where(
              and(
                eq(s.policy.organizationId, organizationId),
                inArray(s.policy.id, relevantPolicies),
              ),
            ),
        ),
        maybe(relevantPolicies.length > 0, () =>
          db
            .select()
            .from(s.configuration)
            .where(inArray(s.configuration.policyId, relevantPolicies)),
        ),
      ],
      { concurrency: "unbounded" },
    );

    const knownPolicyIds = new Set(policyRows.map((row) => row.id));

    const decoded = configurationRows.flatMap((row) => {
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
    const configurations = decoded as Array<PolicyResolutionConfiguration>;

    const linkedUserGroupMemberRows = userGroupMemberRowsForKnownUsers;
    const relevantGroupIds = new Set(memberGroupIds);

    if (targetGroupId !== "") relevantGroupIds.add(targetGroupId);

    const userExclusionRows = relevantGroupIds.size
      ? yield* db
          .select({
            groupId: s.groupExclusion.groupId,
            userId: s.groupExclusion.targetId,
          })
          .from(s.groupExclusion)
          .where(
            and(
              eq(s.groupExclusion.target, "user"),
              inArray(s.groupExclusion.groupId, [...relevantGroupIds]),
            ),
          )
      : [];

    return {
      policies: policyRows,
      configurations,
      devices,
      deviceCount,
      truncated,
      groups: groupRows.filter((group) => relevantGroupIds.has(group.id)),
      groupAssignments: groupAssignments.filter(
        (assignment) =>
          relevantGroupIds.has(assignment.groupId) && knownPolicyIds.has(assignment.policyId),
      ),
      groupMembers: deviceGroupLinks
        .filter((link) => groupIds.has(link.groupId))
        .map((link) => ({ groupId: link.groupId, deviceId: link.deviceId })),
      groupUserExclusions: userExclusionRows.map((row) => ({
        groupId: row.groupId,
        userId: row.userId,
      })),
      deviceAssignments: deviceAssignmentRows
        .filter((row) => knownPolicyIds.has(row.policyId))
        .map((row) => ({
          deviceId: row.deviceId,
          policyId: row.policyId,
          mode: row.mode ?? "include",
        })),
      users,
      deviceUsers: userLinks.filter((link) => knownUserIds.has(link.userId)),
      userGroups: userGroupRows.filter((group) => linkedUserGroupIds.has(group.id)),
      userGroupMembers: linkedUserGroupMemberRows.map((row) => ({
        groupId: row.groupId,
        userId: row.userId,
      })),
      userAssignments: userPolicyRows
        .filter((row) => knownUserIds.has(row.userId) && knownPolicyIds.has(row.policyId))
        .map((row) => ({
          userId: row.userId,
          policyId: row.policyId,
          mode: row.mode ?? "include",
        })),
      userGroupAssignments: userGroupAssignments.filter(
        (assignment) =>
          linkedUserGroupIds.has(assignment.groupId) && knownPolicyIds.has(assignment.policyId),
      ),
    };
  });
