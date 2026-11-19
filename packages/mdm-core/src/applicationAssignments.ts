import { Effect } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { schema as s, type EnterpriseDb } from "@mattrax/enterprise-core";

/**
 * Assigned application ids for one device.
 *
 * An application reaches a device directly, through a device group, or through
 * a directory user group assigned the app whose members are linked to the
 * device. Disabled directory people contribute nothing. The same resolution is
 * used when compiling an Android policy and when retrying an Apple install, so
 * a catalogue app cannot be delivered by one platform and skipped by another.
 */
export const assignedApplicationIdsForDevice = (
  db: EnterpriseDb,
  device: { readonly organizationId: string; readonly deviceId: string },
): Effect.Effect<ReadonlyArray<string>, unknown> =>
  Effect.gen(function* () {
    const direct = yield* db
      .select({ applicationId: s.applicationDevice.applicationId })
      .from(s.applicationDevice)
      .where(eq(s.applicationDevice.deviceId, device.deviceId));

    const groups = yield* db
      .select({ groupId: s.groupDevice.groupId })
      .from(s.groupDevice)
      .where(eq(s.groupDevice.deviceId, device.deviceId));

    const groupApplications = groups.length
      ? yield* db
          .select({ applicationId: s.applicationGroup.applicationId })
          .from(s.applicationGroup)
          .where(
            inArray(
              s.applicationGroup.groupId,
              groups.map((row) => row.groupId),
            ),
          )
      : [];

    const linkedUsers = yield* db
      .select({ userId: s.deviceUser.userId })
      .from(s.deviceUser)
      .where(
        and(
          eq(s.deviceUser.organizationId, device.organizationId),
          eq(s.deviceUser.deviceId, device.deviceId),
        ),
      );

    const linkedUserIds = linkedUsers.map((row) => row.userId);

    const activeUsers = linkedUserIds.length
      ? yield* db
          .select({ id: s.user.id })
          .from(s.user)
          .where(
            and(
              eq(s.user.organizationId, device.organizationId),
              eq(s.user.disabled, false),
              inArray(s.user.id, linkedUserIds),
            ),
          )
      : [];

    const activeUserIds = activeUsers.map((row) => row.id);

    const userGroupMembers = activeUserIds.length
      ? yield* db
          .select({ groupId: s.userGroupMember.groupId })
          .from(s.userGroupMember)
          .where(inArray(s.userGroupMember.userId, activeUserIds))
      : [];

    const userGroupIds = [...new Set(userGroupMembers.map((row) => row.groupId))];

    const userGroupApplications = userGroupIds.length
      ? yield* db
          .select({ applicationId: s.userGroupApplication.applicationId })
          .from(s.userGroupApplication)
          .where(
            and(
              eq(s.userGroupApplication.organizationId, device.organizationId),
              inArray(s.userGroupApplication.groupId, userGroupIds),
            ),
          )
      : [];

    return [
      ...new Set([
        ...direct.map((row) => row.applicationId),
        ...groupApplications.map((row) => row.applicationId),
        ...userGroupApplications.map((row) => row.applicationId),
      ]),
    ];
  });

/**
 * Device ids an application currently reaches, directly, through a device
 * group, or through a directory user group's active members and their linked
 * devices. Backup/wakeup callers use this before and after an assignment edit
 * so a withdrawal reaches the devices that were previously covered.
 */
export const assignedDeviceIdsForApplication = (
  db: EnterpriseDb,
  application: { readonly organizationId: string; readonly applicationId: string },
): Effect.Effect<ReadonlyArray<string>, unknown> =>
  Effect.gen(function* () {
    const direct = yield* db
      .select({ deviceId: s.applicationDevice.deviceId })
      .from(s.applicationDevice)
      .where(eq(s.applicationDevice.applicationId, application.applicationId));

    const groups = yield* db
      .select({ groupId: s.applicationGroup.groupId })
      .from(s.applicationGroup)
      .where(eq(s.applicationGroup.applicationId, application.applicationId));

    const groupDevices = groups.length
      ? yield* db
          .select({ deviceId: s.groupDevice.deviceId })
          .from(s.groupDevice)
          .where(
            inArray(
              s.groupDevice.groupId,
              groups.map((row) => row.groupId),
            ),
          )
      : [];

    const userGroups = yield* db
      .select({ groupId: s.userGroupApplication.groupId })
      .from(s.userGroupApplication)
      .where(
        and(
          eq(s.userGroupApplication.organizationId, application.organizationId),
          eq(s.userGroupApplication.applicationId, application.applicationId),
        ),
      );

    const directoryGroupIds = [...new Set(userGroups.map((row) => row.groupId))];

    const userGroupMembers = directoryGroupIds.length
      ? yield* db
          .select({ userId: s.userGroupMember.userId })
          .from(s.userGroupMember)
          .where(inArray(s.userGroupMember.groupId, directoryGroupIds))
      : [];

    const memberIds = [...new Set(userGroupMembers.map((row) => row.userId))];

    const activeUsers = memberIds.length
      ? yield* db
          .select({ id: s.user.id })
          .from(s.user)
          .where(
            and(
              eq(s.user.organizationId, application.organizationId),
              eq(s.user.disabled, false),
              inArray(s.user.id, memberIds),
            ),
          )
      : [];

    const activeIds = activeUsers.map((row) => row.id);

    const userDevices = activeIds.length
      ? yield* db
          .select({ deviceId: s.deviceUser.deviceId })
          .from(s.deviceUser)
          .where(
            and(
              eq(s.deviceUser.organizationId, application.organizationId),
              inArray(s.deviceUser.userId, activeIds),
            ),
          )
      : [];

    return [
      ...new Set([
        ...direct.map((row) => row.deviceId),
        ...groupDevices.map((row) => row.deviceId),
        ...userDevices.map((row) => row.deviceId),
      ]),
    ];
  });
