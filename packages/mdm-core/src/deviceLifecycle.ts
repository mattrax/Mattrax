import { Effect } from "effect";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { schema as s } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { SYSTEM_AUDIT_ACTIONS, writeSystemAudit } from "./audit.js";
import type { SystemAuditOptions } from "./audit.js";

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
  s.applicationInstall,
  s.applicationUninstall,
  s.deviceLocalAccount,
  s.attributeCollection,
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
  readonly reason?: string;
  /** Enables the `device.unenrolled` webhook for the losing tenant. */
  readonly authSecret?: string;
  readonly webhookDispatch?: SystemAuditOptions["webhookDispatch"];
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
    const destroyedSecretKinds = new Set<string>();

    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        // Capture what is about to be destroyed so the losing tenant's audit
        // log explains the loss without storing any sealed value.
        const secrets = yield* tx
          .select({ kind: s.deviceSecret.kind })
          .from(s.deviceSecret)
          .where(eq(s.deviceSecret.deviceId, device.id));

        for (const secret of secrets) destroyedSecretKinds.add(secret.kind);

        if (certificateDeviceIds.length > 0)
          yield* tx
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
        yield* tx
          .update(s.abmDevice)
          .set({ deviceId: null })
          .where(eq(s.abmDevice.deviceId, device.id));
        yield* tx
          .update(s.autopilotDevice)
          .set({ deviceId: null })
          .where(eq(s.autopilotDevice.deviceId, device.id));
        yield* tx
          .update(s.devicePreRegistration)
          .set({ consumedDeviceId: null, updatedAt: now })
          .where(eq(s.devicePreRegistration.consumedDeviceId, device.id));

        for (const table of deviceChildTables)
          yield* tx.delete(table).where(eq(table.deviceId, device.id));

        yield* tx.delete(s.device).where(eq(s.device.id, device.id));
      }),
    );

    // Audit only after the delete committed. A failed cleanup must not leave a
    // deletion record for a device the losing tenant still owns.
    yield* writeSystemAudit(
      db,
      {
        organizationId: device.organizationId,
        action: SYSTEM_AUDIT_ACTIONS.deviceDeleted,
        targetType: "device",
        targetId: device.id,
        metadata: {
          reason: input.reason ?? "re-enrolled in another tenant",
          previousTenantId: device.organizationId,
          deviceId: device.id,
          dmIdentifier: device.dmIdentifier ?? null,
          destroyedSecretKinds: [...destroyedSecretKinds].sort(),
        },
      },
      { authSecret: input.authSecret, webhookDispatch: input.webhookDispatch },
    );
  });
};
