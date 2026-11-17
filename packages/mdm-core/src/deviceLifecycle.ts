import { Effect } from "effect";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { schema as s, type EnterpriseDb } from "@mattrax/enterprise-core";

/**
 * The device row and everything that hangs off it.
 *
 * A device that moves to another tenant must not leave its old row behind:
 * stale-unenrol only reaches rows the maintenance sweep still knows about, and
 * until then the previous tenant keeps a managed device it cannot reach, plus
 * its seats, policies and group memberships. Production declares `ON DELETE
 * CASCADE` for the child tables, but this deletes them explicitly so the
 * behaviour does not depend on foreign-key rules (tests and imported
 * databases may be missing them).
 */
const deviceChildTables = [
  s.deviceApple,
  s.deviceAppleUser,
  s.deviceDeclaration,
  s.deviceCommand,
  s.deviceAttribute,
  s.deviceSecret,
  s.deviceApplication,
  s.deviceVppAssignment,
  s.groupDevice,
  s.applicationDevice,
  s.devicePolicy,
  s.deviceUser,
  s.androidDevice,
  s.scriptExecution,
] as const;

/** A device row that belonged to the tenant it is no longer enrolling into. */
export type DepartedTenantDevice = {
  readonly id: string;
  readonly organizationId: string;
  readonly dmIdentifier?: string | null;
};

/**
 * Remove a device that has re-enrolled into another tenant.
 *
 * Identity certificates are revoked rather than deleted: an old certificate
 * must not remain usable to authenticate a check-in, but keeping the row
 * preserves the audit trail for the previous tenant. The device row itself is
 * deleted so the old tenant no longer sees or pays for a device it cannot
 * manage.
 */
export const deleteDepartedTenantDevice = (input: {
  readonly db: EnterpriseDb;
  readonly device: DepartedTenantDevice;
  readonly now?: Date;
}): Effect.Effect<void, unknown> => {
  const { db, device } = input;
  const now = input.now ?? new Date();

  // Certificates can be keyed by the internal row id or by a legacy platform
  // identifier (for example the Windows DeviceID).
  const certificateDeviceIds = [device.id, device.dmIdentifier].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  return Effect.gen(function* () {
    if (certificateDeviceIds.length > 0)
      yield* db
        .update(s.scepIssuedCertificate)
        .set({ revokedAt: now })
        .where(
          and(
            eq(s.scepIssuedCertificate.organizationId, device.organizationId),
            inArray(s.scepIssuedCertificate.deviceId, certificateDeviceIds),
            isNull(s.scepIssuedCertificate.revokedAt),
          ),
        );

    // References that stay valid when the device row disappears.
    yield* db
      .update(s.abmDevice)
      .set({ deviceId: null })
      .where(eq(s.abmDevice.deviceId, device.id));
    yield* db
      .update(s.autopilotDevice)
      .set({ deviceId: null })
      .where(eq(s.autopilotDevice.deviceId, device.id));
    yield* db
      .update(s.devicePreRegistration)
      .set({ consumedDeviceId: null, updatedAt: now })
      .where(eq(s.devicePreRegistration.consumedDeviceId, device.id));

    for (const table of deviceChildTables)
      yield* db.delete(table).where(eq(table.deviceId, device.id));

    yield* db.delete(s.device).where(eq(s.device.id, device.id));
  });
};
