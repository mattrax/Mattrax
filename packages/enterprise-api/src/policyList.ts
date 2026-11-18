import type { PolicyDeliveryInfo, PolicyDeliveryState } from "@mattrax/enterprise-domain";
import {
  configurationDeclarationIdentifier,
  isDeclarationFailure,
  isLegacyKind,
  parseConfigurationKind,
  splitConfigurationDeclarationIdentifier,
} from "@mattrax/mdm-apple";

/**
 * Bulk policy scope and delivery derivation for the policy list.
 *
 * This is the list-row counterpart of `resolveEffectivePolicyForDevice`: it
 * must not resolve every device individually (that would be one round of
 * queries per device), so the handler loads the tenant's assignment edges in a
 * fixed number of bulk reads and these pure helpers do the set arithmetic.
 *
 * Scope is policy-level, matching the resolver's veto rules:
 *
 * - A direct device include wins over a group exclusion.
 * - A direct device exclude removes the policy, including group and user
 *   sources.
 * - Any group exclusion for a policy vetoes every group include for that
 *   policy, and also user-sourced delivery on devices in that group.
 * - A direct user include survives user-group exclusions for that user.
 * - A directly excluded user, or a user in an excluded directory group, does
 *   not contribute unless they are directly included.
 *
 * `deviceCount` is the number of distinct devices in that scope. It is not a
 * count of configuration-kind winners: a higher-priority policy can still
 * override one of this policy's kinds on some of those devices, so the row
 * describes reach, not guaranteed per-kind delivery.
 */

export type PolicyScopeInput = {
  readonly policyIds: ReadonlyArray<string>;
  /** Tenant-scoped devices that can appear in an assignment edge. */
  readonly devices: ReadonlyArray<{ readonly id: string }>;
  /** Device group assignments (`group_policy`), already tenant-scoped. */
  readonly groupAssignments: ReadonlyArray<{
    readonly policyId: string;
    readonly groupId: string;
    readonly mode?: string | null;
  }>;
  /** Device membership of those groups (`group_device`). */
  readonly groupMembers: ReadonlyArray<{
    readonly groupId: string;
    readonly deviceId: string;
  }>;
  /** Direct device assignments (`device_policy`). */
  readonly deviceAssignments: ReadonlyArray<{
    readonly policyId: string;
    readonly deviceId: string;
    readonly mode?: string | null;
  }>;
  /** Direct user assignments (`user_policy`). */
  readonly userAssignments: ReadonlyArray<{
    readonly policyId: string;
    readonly userId: string;
    readonly mode?: string | null;
  }>;
  /** Directory-group assignments (`user_group_policy`), tenant-scoped. */
  readonly userGroupAssignments: ReadonlyArray<{
    readonly policyId: string;
    readonly groupId: string;
    readonly mode?: string | null;
  }>;
  /** Membership of the assigned directory groups (`user_group_member`). */
  readonly userGroupMembers: ReadonlyArray<{
    readonly groupId: string;
    readonly userId: string;
  }>;
  /** Users linked to devices (`device_user`), tenant-scoped. */
  readonly deviceUsers: ReadonlyArray<{
    readonly deviceId: string;
    readonly userId: string;
  }>;
  /**
   * Users that can receive policy today: tenant members whose account is not
   * disabled. The resolver filters the same way.
   */
  readonly activeUserIds: ReadonlySet<string>;
};

export type PolicyScope = {
  readonly deviceIds: ReadonlySet<string>;
  readonly userIds: ReadonlySet<string>;
};

const mode = (value: string | null | undefined) => (value === "exclude" ? "exclude" : "include");

const addTo = (map: Map<string, Set<string>>, key: string, value: string) => {
  const values = map.get(key) ?? new Set<string>();

  values.add(value);
  map.set(key, values);
};

const setFor = (map: Map<string, Set<string>>, key: string) => map.get(key) ?? new Set<string>();

/** Resolve the device and user scope of every policy in one pass. */
export const resolvePolicyScopes = (input: PolicyScopeInput) => {
  const knownPolicies = new Set(input.policyIds);
  const tenantDevices = new Set(input.devices.map((device) => device.id));

  const directDeviceIncludes = new Map<string, Set<string>>();
  const directDeviceExcludes = new Map<string, Set<string>>();
  const groupIncludes = new Map<string, Set<string>>();
  const groupExcludes = new Map<string, Set<string>>();
  const directUserIncludes = new Map<string, Set<string>>();
  const directUserExcludes = new Map<string, Set<string>>();
  const userGroupIncludes = new Map<string, Set<string>>();
  const userGroupExcludes = new Map<string, Set<string>>();

  for (const assignment of input.deviceAssignments) {
    if (!knownPolicies.has(assignment.policyId)) continue;

    addTo(
      mode(assignment.mode) === "exclude" ? directDeviceExcludes : directDeviceIncludes,
      assignment.policyId,
      assignment.deviceId,
    );
  }

  for (const assignment of input.groupAssignments) {
    if (!knownPolicies.has(assignment.policyId)) continue;

    addTo(
      mode(assignment.mode) === "exclude" ? groupExcludes : groupIncludes,
      assignment.policyId,
      assignment.groupId,
    );
  }

  for (const assignment of input.userAssignments) {
    if (!knownPolicies.has(assignment.policyId)) continue;

    addTo(
      mode(assignment.mode) === "exclude" ? directUserExcludes : directUserIncludes,
      assignment.policyId,
      assignment.userId,
    );
  }

  for (const assignment of input.userGroupAssignments) {
    if (!knownPolicies.has(assignment.policyId)) continue;

    addTo(
      mode(assignment.mode) === "exclude" ? userGroupExcludes : userGroupIncludes,
      assignment.policyId,
      assignment.groupId,
    );
  }

  const groupMembers = new Map<string, Set<string>>();

  for (const row of input.groupMembers) {
    if (!tenantDevices.has(row.deviceId)) continue;
    addTo(groupMembers, row.groupId, row.deviceId);
  }

  const userGroupMembers = new Map<string, Set<string>>();

  for (const row of input.userGroupMembers) {
    if (!input.activeUserIds.has(row.userId)) continue;
    addTo(userGroupMembers, row.groupId, row.userId);
  }

  // Only devices linked to a user that can appear in a user assignment are
  // loaded by the handler, but keep the tenant check here so a stale edge
  // cannot inflate a count.
  const devicesByUser = new Map<string, Set<string>>();

  for (const row of input.deviceUsers) {
    if (!input.activeUserIds.has(row.userId) || !tenantDevices.has(row.deviceId)) continue;
    addTo(devicesByUser, row.userId, row.deviceId);
  }

  const scopes = new Map<string, PolicyScope>();

  for (const policyId of input.policyIds) {
    const deviceIds = new Set<string>();
    const userIds = new Set<string>();
    const excludedDevices = new Set<string>();

    for (const deviceId of setFor(directDeviceExcludes, policyId))
      if (tenantDevices.has(deviceId)) excludedDevices.add(deviceId);

    for (const groupId of setFor(groupExcludes, policyId))
      for (const deviceId of setFor(groupMembers, groupId)) excludedDevices.add(deviceId);

    // Direct includes override every group exclusion.
    for (const deviceId of setFor(directDeviceIncludes, policyId))
      if (tenantDevices.has(deviceId)) deviceIds.add(deviceId);

    for (const groupId of setFor(groupIncludes, policyId))
      for (const deviceId of setFor(groupMembers, groupId))
        if (!excludedDevices.has(deviceId)) deviceIds.add(deviceId);

    const excludedUserIds = new Set<string>();

    for (const groupId of setFor(userGroupExcludes, policyId))
      for (const userId of setFor(userGroupMembers, groupId)) excludedUserIds.add(userId);

    // Direct user includes override user-group exclusions for that user.
    for (const userId of setFor(directUserIncludes, policyId))
      if (input.activeUserIds.has(userId)) userIds.add(userId);

    const excludedDirectUsers = setFor(directUserExcludes, policyId);

    for (const groupId of setFor(userGroupIncludes, policyId))
      for (const userId of setFor(userGroupMembers, groupId)) {
        if (userIds.has(userId)) continue;

        if (excludedDirectUsers.has(userId)) continue;

        if (excludedUserIds.has(userId)) continue;

        userIds.add(userId);
      }

    for (const userId of userIds)
      for (const deviceId of setFor(devicesByUser, userId))
        if (!excludedDevices.has(deviceId)) deviceIds.add(deviceId);

    scopes.set(policyId, { deviceIds, userIds });
  }

  return scopes;
};

export type PolicyDeclarationReport = {
  readonly deviceId: string;
  readonly identifier: string;
  readonly valid: string;
  readonly active: boolean;
  readonly serverToken?: string | null;
};

export type PolicyDeliveryConfiguration = {
  readonly kind: string;
  readonly hash: string;
  /**
   * True when the payload contains policy variables. The stored hash is the
   * template hash while the published declaration token is the resolved hash,
   * so the two cannot be compared for these configurations.
   */
  readonly hasVariables?: boolean;
};

export type PolicyDeliveryInput = {
  readonly policyId: string;
  /** Latest `policy_deployment.version`, or null when none exists. */
  readonly version: number | null;
  /** Current configuration kinds and their content hashes. */
  readonly configurations: ReadonlyArray<PolicyDeliveryConfiguration>;
  /** Devices in the policy's scope. */
  readonly devices: ReadonlyArray<{
    readonly id: string;
    readonly proto: string;
    readonly declarationMode?: string | null;
  }>;
  /** Declaration reports for the scoped devices. */
  readonly declarations: ReadonlyArray<PolicyDeclarationReport>;
};

/**
 * Only declarable Apple kinds are published as DDM declarations. A mixed policy
 * can also carry Windows and Android configurations, and applications are
 * installed imperatively (they never publish a declaration), so none of those
 * kinds can ever produce delivery evidence.
 */
const isDeclarableAppleKind = (kind: string) => {
  switch (parseConfigurationKind(kind).type) {
    case "device":
    case "custom":
    case "certificate":
    case "declaration":
      return true;
    default:
      return false;
  }
};

/**
 * Whether a declaration report describes the current configuration content.
 *
 * Legacy profile tokens, variable-substituted tokens and reports without a
 * token cannot be compared to the stored template hash. They fall back to the
 * reported status. A token that is present and different means the device is
 * still reporting a previous save.
 */
const declarationIsCurrent = (
  configuration: PolicyDeliveryConfiguration,
  declaration: PolicyDeclarationReport,
) => {
  if (isLegacyKind(configuration.kind) || configuration.hasVariables) return true;

  if (declaration.serverToken == null || declaration.serverToken === "") return true;

  return declaration.serverToken === configuration.hash;
};

/**
 * Per-device declaration evidence, indexed by the shared declaration
 * identifier and by configuration kind. The kind index lets delivery tell
 * "this policy has not reported yet" apart from "another policy won this kind
 * on the device", which is the cheap contribution signal used below.
 */
type DeviceEvidence = {
  readonly byIdentifier: Map<string, PolicyDeclarationReport>;
  readonly byKind: Map<string, Set<string>>;
};

/**
 * Derive one delivery state for the policy's current configuration.
 *
 * A device counts as delivered only when every current declarable Apple kind
 * has a declaration that is valid and active. For kinds whose declaration token
 * is the content hash (everything except legacy device/custom profiles and
 * variable-bearing payloads) the token must also match the current hash, so a
 * device that reported the previous save does not look delivered.
 *
 * Contribution is inferred from declarations rather than re-running the full
 * per-device resolver: only one policy wins a configuration kind for a device,
 * so a declaration for the same kind from another policy means this policy did
 * not contribute it. A device whose kinds are all provided by other policies is
 * counted as `overridden` rather than pending forever. A kind with no
 * declaration from any policy can still be pending because the device has not
 * checked in, or because the platform/OS does not support that kind; those
 * cases remain in `pending` and the UI copy says so.
 *
 * Apple devices recorded on the legacy profile path never sync DDM
 * declarations. They are excluded from `trackedDevices` (and counted in
 * `legacyDevices`) instead of looking pending forever.
 */
export const derivePolicyDelivery = (input: PolicyDeliveryInput): PolicyDeliveryInfo => {
  const scopedDevices = input.devices.length;
  const appleDevices = input.devices.filter((device) => device.proto === "apple");
  const legacyDevices = appleDevices.filter((device) => device.declarationMode === "legacy").length;
  const trackedDevices = appleDevices.length - legacyDevices;

  const results = {
    version: input.version,
    scopedDevices,
    trackedDevices,
    legacyDevices,
    overriddenDevices: 0,
    deliveredDevices: 0,
    failedDevices: 0,
    pendingDevices: 0,
  };

  const state = (value: PolicyDeliveryState): PolicyDeliveryInfo => ({ state: value, ...results });

  if (input.version === null) return state("never-deployed");

  if (scopedDevices === 0) return state("no-devices");

  if (trackedDevices === 0) return state("not-tracked");

  const configurations = input.configurations.filter((row) => isDeclarableAppleKind(row.kind));

  if (configurations.length === 0) return state("no-configurations");

  const evidenceByDevice = new Map<string, DeviceEvidence>();

  for (const declaration of input.declarations) {
    const parsed = splitConfigurationDeclarationIdentifier(declaration.identifier);

    if (!parsed.policyId || !parsed.kind) continue;

    const evidence = evidenceByDevice.get(declaration.deviceId) ?? {
      byIdentifier: new Map<string, PolicyDeclarationReport>(),
      byKind: new Map<string, Set<string>>(),
    };

    evidence.byIdentifier.set(declaration.identifier, declaration);
    const policiesForKind = evidence.byKind.get(parsed.kind) ?? new Set<string>();

    policiesForKind.add(parsed.policyId);
    evidence.byKind.set(parsed.kind, policiesForKind);
    evidenceByDevice.set(declaration.deviceId, evidence);
  }

  let deliveredDevices = 0;
  let failedDevices = 0;
  let pendingDevices = 0;
  let overriddenDevices = 0;

  for (const device of appleDevices) {
    if (device.declarationMode === "legacy") continue;

    const evidence = evidenceByDevice.get(device.id);
    let failed = false;
    let deliveredKinds = 0;
    let overriddenKinds = 0;

    for (const configuration of configurations) {
      const identifier = configurationDeclarationIdentifier(input.policyId, configuration.kind);
      const declaration = evidence?.byIdentifier.get(identifier);

      if (!declaration) {
        // Another policy published this kind for the device, so this policy
        // cannot have contributed it. No evidence at all stays pending.
        if (evidence?.byKind.get(configuration.kind)?.size) overriddenKinds++;

        continue;
      }

      const current = declarationIsCurrent(configuration, declaration);

      if (isDeclarationFailure(declaration.valid)) {
        // A stale failure from a previous save is not the current state.
        if (current) failed = true;

        continue;
      }

      // `unknown` and inactive declarations are not evidence of delivery.
      if (declaration.valid.trim().toLowerCase() !== "valid") continue;

      if (!declaration.active || !current) continue;

      deliveredKinds++;
    }

    if (failed) failedDevices++;
    else if (deliveredKinds === configurations.length) deliveredDevices++;
    else if (overriddenKinds === configurations.length) overriddenDevices++;
    else pendingDevices++;
  }

  results.deliveredDevices = deliveredDevices;
  results.failedDevices = failedDevices;
  results.pendingDevices = pendingDevices;
  results.overriddenDevices = overriddenDevices;

  const applicableDevices = trackedDevices - overriddenDevices;

  if (applicableDevices === 0) return state("not-applicable");

  if (deliveredDevices === applicableDevices) return state("delivered");

  if (deliveredDevices > 0) return state("partial");

  if (failedDevices > 0) return state("failed");

  return state("pending");
};
