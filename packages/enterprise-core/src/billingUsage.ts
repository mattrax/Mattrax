import { Effect } from "effect";
import { and, count, eq } from "drizzle-orm";
import type { EnterpriseDb } from "./db.ts";
import { ownedTenantIds } from "./planLimits.ts";
import { device, organization } from "./schema.ts";

/**
 * Usage the application reports to the services deployment.
 *
 * Billing lives in its own database, so it cannot count devices itself. These
 * helpers are the only place the application reads its own fleet for billing;
 * everything downstream transports the numbers.
 */

/** Enrolled devices and tenant count across a self-hosted deployment. */
export const deploymentUsage = (db: EnterpriseDb) =>
  Effect.gen(function* () {
    const [devices] = yield* db
      .select({ value: count() })
      .from(device)
      .where(eq(device.status, "enrolled"));

    const [tenants] = yield* db.select({ value: count() }).from(organization);

    return {
      deviceCount: devices?.value ?? 0,
      tenantCount: tenants?.value ?? 0,
    };
  });

/** Devices that cost a seat: enrolled only, not enrolling or retired. */
export const billableDeviceCount = (db: EnterpriseDb, organizationId: string) =>
  Effect.gen(function* () {
    const [row] = yield* db
      .select({ value: count() })
      .from(device)
      .where(and(eq(device.organizationId, organizationId), eq(device.status, "enrolled")));

    return row?.value ?? 0;
  });

/**
 * A tenant's usage snapshot for the hosted billing summary and checkout.
 * The account's owned-tenant count feeds the tenant-plan limit message.
 */
export const billingUsageForOrganization = (
  db: EnterpriseDb,
  organizationId: string,
  accountId: string,
) =>
  Effect.gen(function* () {
    const [devices] = yield* db
      .select({ value: count() })
      .from(device)
      .where(eq(device.organizationId, organizationId));

    const billable = yield* billableDeviceCount(db, organizationId);
    const owned = yield* ownedTenantIds(db, accountId);

    return {
      deviceCount: billable,
      devicesUsed: devices?.value ?? 0,
      tenantCount: owned.length,
    };
  });
