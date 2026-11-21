import type {
  PolicyDeploymentCounts,
  PolicyDeploymentDevice,
  PolicyDeploymentDeviceStatus,
  PolicyDeploymentPlatform,
  PolicyDeliveryState,
} from "@mattrax/enterprise-domain";
import { splitConfigurationDeclarationIdentifier } from "@mattrax/mdm-apple";
import { isDeclarableAppleKind, resolveAppleDeviceDelivery } from "./policyList.js";
import type { PolicyDeclarationReport, PolicyDeliveryConfiguration } from "./policyList.js";

/**
 * Per-device deployment progress for one saved policy version.
 *
 * The version's snapshot is authoritative for what was deployed: a later save
 * must not make an older version look delivered. Scope is resolved from the
 * current assignment graph, because the scope itself is not snapshotted; a
 * device that still reports the version but has left the scope is surfaced as
 * "not-in-scope" instead of being silently dropped.
 *
 * Only Apple devices on the DDM path report declarations. Windows, Android and
 * legacy-profile Apple devices are untracked: they are in the fan-out and are
 * counted, but no code path is allowed to call them delivered. A successful
 * legacy profile install command is recorded as evidence time only; the status
 * stays untracked.
 */

export type PolicyDeploymentDeviceRow = {
  readonly id: string;
  readonly name: string;
  readonly proto: string;
  readonly declarationMode?: string | null;
};

export type PolicyDeploymentCommand = {
  readonly deviceId: string;
  readonly requestType: string;
  readonly status: string;
  readonly updatedAt: string;
};

export type PolicyDeploymentInput = {
  readonly policyId: string;
  readonly version: number;
  /**
   * Configuration kinds from the version's snapshot, including Windows and
   * Android kinds. Only declarable Apple device kinds can produce evidence.
   */
  readonly configurations: ReadonlyArray<PolicyDeliveryConfiguration>;
  /** The version only has user-scoped kinds, which device reports never see. */
  readonly hasUserScopedConfigurations?: boolean;
  /** Devices in the policy's current scope. */
  readonly devices: ReadonlyArray<PolicyDeploymentDeviceRow>;
  /**
   * Devices the assignment graph reaches but the current scope excludes. A row
   * is reported only when it still holds a declaration for this policy.
   */
  readonly outOfScopeDevices?: ReadonlyArray<PolicyDeploymentDeviceRow>;
  /** Declaration reports for every device above, from every policy. */
  readonly declarations: ReadonlyArray<PolicyDeclarationReport>;
  /** Apple command history for legacy devices in scope. */
  readonly commands?: ReadonlyArray<PolicyDeploymentCommand>;
};

export type PolicyDeploymentResolution = {
  readonly state: PolicyDeliveryState;
  readonly counts: PolicyDeploymentCounts;
  readonly devices: ReadonlyArray<PolicyDeploymentDevice>;
};

const platformOf = (proto: string): PolicyDeploymentPlatform => {
  switch (proto) {
    case "win":
      return "windows";
    case "android":
      return "android";
    default:
      return "apple";
  }
};

const isTrackedApple = (device: PolicyDeploymentDeviceRow) =>
  device.proto === "apple" && device.declarationMode !== "legacy";

/** The device is an Apple device on the legacy .mobileconfig path. */
const isLegacyApple = (device: PolicyDeploymentDeviceRow) =>
  device.proto === "apple" && device.declarationMode === "legacy";

const latestInstall = (commands: ReadonlyArray<PolicyDeploymentCommand>) => {
  let latest: string | null = null;

  for (const command of commands) {
    if (command.requestType !== "InstallProfile" || command.status !== "succeeded") continue;

    if (!latest || command.updatedAt > latest) latest = command.updatedAt;
  }

  return latest;
};

const plural = (count: number, singular: string, pluralForm: string) =>
  String(count) + " " + (count === 1 ? singular : pluralForm);

const kindList = (kinds: ReadonlyArray<string>) => kinds.join(", ");

/** Status rank: the devices an operator has to act on come first. */
const statusRank: Record<PolicyDeploymentDeviceStatus, number> = {
  failed: 0,
  pending: 1,
  delivered: 2,
  untracked: 3,
  "not-applicable": 4,
  "not-in-scope": 5,
};

const byActionFirst = (left: PolicyDeploymentDevice, right: PolicyDeploymentDevice) =>
  statusRank[left.status] - statusRank[right.status] ||
  left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
  left.deviceId.localeCompare(right.deviceId);

const trackedRow = (args: {
  readonly device: PolicyDeploymentDeviceRow;
  readonly delivery: ReturnType<typeof resolveAppleDeviceDelivery>;
  readonly configurations: number;
}): PolicyDeploymentDevice => {
  const { device, delivery, configurations } = args;
  const applicableKinds = configurations - delivery.overriddenKinds;

  switch (delivery.status) {
    case "failed":
      return {
        deviceId: device.id,
        name: device.name,
        platform: "apple",
        status: "failed",
        applicableKinds,
        deliveredKinds: delivery.deliveredKinds,
        lastEvidenceAt: delivery.lastEvidenceAt,
        reason: "Invalid declaration: " + kindList(delivery.failedKinds) + ".",
      };
    case "delivered":
      return {
        deviceId: device.id,
        name: device.name,
        platform: "apple",
        status: "delivered",
        applicableKinds,
        deliveredKinds: delivery.deliveredKinds,
        lastEvidenceAt: delivery.lastEvidenceAt,
        reason:
          configurations === 1
            ? "The configuration is reported valid and active."
            : "All " +
              plural(configurations, "configuration is", "configurations are") +
              " reported valid and active.",
      };
    case "not-applicable":
      return {
        deviceId: device.id,
        name: device.name,
        platform: "apple",
        status: "not-applicable",
        applicableKinds: 0,
        deliveredKinds: 0,
        lastEvidenceAt: delivery.lastEvidenceAt,
        reason: "Every configuration is provided by another policy.",
      };
    case "pending":
      return {
        deviceId: device.id,
        name: device.name,
        platform: "apple",
        status: "pending",
        applicableKinds,
        deliveredKinds: delivery.deliveredKinds,
        lastEvidenceAt: delivery.lastEvidenceAt,
        reason:
          delivery.deliveredKinds === 0
            ? "No report for this version yet."
            : String(delivery.deliveredKinds) +
              " of " +
              String(applicableKinds) +
              " configurations reported.",
      };
  }
};

/**
 * Resolve one deployment version into per-device statuses and counts.
 *
 * The returned rows are ordered action-needed first, then by name, so the
 * handler can slice a stable page without re-sorting.
 */
export const resolvePolicyDeployment = (
  input: PolicyDeploymentInput,
): PolicyDeploymentResolution => {
  const configurations = input.configurations.filter((row) => isDeclarableAppleKind(row.kind));
  const scopedIds = new Set(input.devices.map((device) => device.id));

  const declarationsByDevice = new Map<string, Array<PolicyDeclarationReport>>();

  for (const declaration of input.declarations) {
    const list = declarationsByDevice.get(declaration.deviceId) ?? [];

    list.push(declaration);
    declarationsByDevice.set(declaration.deviceId, list);
  }

  const commandsByDevice = new Map<string, Array<PolicyDeploymentCommand>>();

  for (const command of input.commands ?? []) {
    const list = commandsByDevice.get(command.deviceId) ?? [];

    list.push(command);
    commandsByDevice.set(command.deviceId, list);
  }

  const evidenceDeviceIds = new Set(
    input.declarations
      .filter(
        (declaration) =>
          splitConfigurationDeclarationIdentifier(declaration.identifier).policyId ===
          input.policyId,
      )
      .map((declaration) => declaration.deviceId),
  );

  const rows: Array<PolicyDeploymentDevice> = [];

  for (const device of input.devices) {
    const platform = platformOf(device.proto);

    if (platform !== "apple") {
      rows.push({
        deviceId: device.id,
        name: device.name,
        platform,
        status: "untracked",
        applicableKinds: 0,
        deliveredKinds: 0,
        lastEvidenceAt: null,
        reason:
          platform === "windows"
            ? "Windows does not report declaration status."
            : "Android does not report declaration status.",
      });
      continue;
    }

    if (isLegacyApple(device)) {
      const installedAt = latestInstall(commandsByDevice.get(device.id) ?? []);

      rows.push({
        deviceId: device.id,
        name: device.name,
        platform: "apple",
        status: "untracked",
        applicableKinds: 0,
        deliveredKinds: 0,
        lastEvidenceAt: installedAt,
        reason: installedAt
          ? "A legacy profile install succeeded, but legacy profiles do not report declaration status."
          : "Legacy profiles do not report declaration status.",
      });
      continue;
    }

    if (configurations.length === 0) {
      rows.push({
        deviceId: device.id,
        name: device.name,
        platform: "apple",
        status: "not-applicable",
        applicableKinds: 0,
        deliveredKinds: 0,
        lastEvidenceAt: null,
        reason:
          input.configurations.length === 0
            ? "This policy only has user-channel settings."
            : "This version has no Apple configuration kinds.",
      });
      continue;
    }

    const delivery = resolveAppleDeviceDelivery({
      policyId: input.policyId,
      configurations,
      declarations: declarationsByDevice.get(device.id) ?? [],
    });

    rows.push(
      trackedRow({
        device,
        delivery,
        configurations: configurations.length,
      }),
    );
  }

  for (const device of input.outOfScopeDevices ?? []) {
    if (scopedIds.has(device.id) || !evidenceDeviceIds.has(device.id)) continue;

    const delivery = resolveAppleDeviceDelivery({
      policyId: input.policyId,
      configurations,
      declarations: declarationsByDevice.get(device.id) ?? [],
    });

    rows.push({
      deviceId: device.id,
      name: device.name,
      platform: platformOf(device.proto),
      status: "not-in-scope",
      applicableKinds: 0,
      deliveredKinds: delivery.deliveredKinds,
      lastEvidenceAt: delivery.lastEvidenceAt,
      reason: "No longer in the policy's scope, but still reports this version's declarations.",
    });
  }

  rows.sort(byActionFirst);

  const count = (status: PolicyDeploymentDeviceStatus) =>
    rows.filter((row) => row.status === status).length;

  const counts: PolicyDeploymentCounts = {
    total: rows.length,
    scoped: input.devices.length,
    delivered: count("delivered"),
    pending: count("pending"),
    failed: count("failed"),
    notApplicable: count("not-applicable"),
    untracked: count("untracked"),
    notInScope: count("not-in-scope"),
  };

  const trackedDevices = input.devices.filter(isTrackedApple).length;
  const applicable = counts.delivered + counts.pending + counts.failed;

  let state: PolicyDeliveryState;

  if (configurations.length === 0)
    state = input.hasUserScopedConfigurations ? "user-channel" : "no-configurations";
  else if (input.devices.length === 0) state = "no-devices";
  else if (trackedDevices === 0) state = "not-tracked";
  else if (applicable === 0) state = "not-applicable";
  else if (counts.delivered === applicable) state = "delivered";
  else if (counts.delivered > 0) state = "partial";
  else if (counts.failed > 0) state = "failed";
  else state = "pending";

  return { state, counts, devices: rows };
};
