/**
 * Catalogue-app uninstall state.
 *
 * A command only proves the device accepted the request. Whether the app is
 * really gone is only knowable from the next application inventory, so an
 * uninstall is tracked until that report confirms (or contradicts) it. The
 * planning here is pure so the deadline rule is unit tested without a device.
 */

import { Schema } from "effect";
import type { ApplicationPlatform } from "./Application.js";

/**
 * How long a device gets to remove an app and report a fresh inventory. The
 * 24 hour window matches the install/remove command budget: after it, an app
 * still in inventory is a failure rather than a slow download.
 */
export const APPLICATION_UNINSTALL_DEADLINE_MS = 24 * 60 * 60 * 1000;

export const ApplicationUninstallStatus = Schema.Literals([
  "queued",
  "succeeded",
  "failed",
  "cancelled",
]);

export type ApplicationUninstallStatus = typeof ApplicationUninstallStatus.Type;

/** The row shapes reconciliation needs; dates are normalised by the caller. */
export type ApplicationUninstallCandidate = {
  readonly id: string;
  readonly applicationId: string;
  readonly platform: ApplicationPlatform;
  readonly bundleId: string;
  readonly status: ApplicationUninstallStatus;
  readonly deadline: Date;
  readonly commandId?: string | null;
  readonly adamId?: string | null;
};

export type InstalledApplicationSnapshot = {
  readonly bundleId: string;
  readonly version?: string | null;
};

export type ApplicationUninstallTransition = {
  readonly id: string;
  readonly applicationId: string;
  readonly platform: ApplicationPlatform;
  readonly bundleId: string;
  readonly status: "succeeded" | "failed";
  readonly resultDetail: string;
  readonly observedVersion?: string;
  readonly commandId?: string;
  readonly adamId?: string;
};

/**
 * Whether two identifiers name the same installed application.
 *
 * Windows product codes are reported inconsistently (with or without braces,
 * in any case), so they compare normalised. Apple bundle ids and Android
 * package names are exact.
 */
export const sameApplicationBundle = (
  platform: ApplicationPlatform,
  left: string,
  right: string,
): boolean => {
  if (platform === "win") {
    const normalize = (value: string) => value.trim().replaceAll(/[{}]/g, "").toUpperCase();

    return normalize(left) === normalize(right);
  }

  return left.trim() === right.trim();
};

/**
 * Decide which outstanding uninstalls a device's inventory resolves.
 *
 * Gone -> `succeeded`. Still present after the deadline -> `failed` with the
 * observed version, so an operator can see what the device actually kept
 * rather than a bare "still installed". Present before the deadline stays
 * `queued`: a removal can legitimately lag its command.
 */
export const planApplicationUninstallReconciliation = (
  rows: ReadonlyArray<ApplicationUninstallCandidate>,
  installed: ReadonlyArray<InstalledApplicationSnapshot>,
  at: Date,
): ReadonlyArray<ApplicationUninstallTransition> => {
  const transitions: Array<ApplicationUninstallTransition> = [];

  for (const row of rows) {
    if (row.status !== "queued") continue;

    const present = installed.find((application) =>
      sameApplicationBundle(row.platform, application.bundleId, row.bundleId),
    );

    if (!present) {
      transitions.push({
        id: row.id,
        applicationId: row.applicationId,
        platform: row.platform,
        bundleId: row.bundleId,
        status: "succeeded",
        resultDetail: "The application is no longer in the inventory the device reported.",
        ...(row.commandId ? { commandId: row.commandId } : {}),
        ...(row.adamId ? { adamId: row.adamId } : {}),
      });
      continue;
    }

    if (at.getTime() < row.deadline.getTime()) continue;

    const version = present.version?.trim() || undefined;

    transitions.push({
      id: row.id,
      applicationId: row.applicationId,
      platform: row.platform,
      bundleId: row.bundleId,
      status: "failed",
      observedVersion: version,
      resultDetail: version
        ? `The application is still installed at version ${version} after the uninstall deadline.`
        : "The application is still installed after the uninstall deadline.",
      ...(row.commandId ? { commandId: row.commandId } : {}),
      ...(row.adamId ? { adamId: row.adamId } : {}),
    });
  }

  return transitions;
};
