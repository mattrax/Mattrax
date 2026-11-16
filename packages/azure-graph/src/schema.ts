import { Schema } from "effect";

/**
 * Fields come back as `null` when Entra has no value for them, so wire schemas
 * accept `null` and the mappers below normalise it to `undefined`.
 */
const optionalString = Schema.optional(Schema.NullOr(Schema.String));

const optionalBoolean = Schema.optional(Schema.NullOr(Schema.Boolean));

const RemovedReason = Schema.Struct({
  reason: Schema.optional(Schema.NullOr(Schema.String)),
});

type RemovedReason = typeof RemovedReason.Type;

const GraphUserWire = Schema.Struct({
  id: Schema.String,
  displayName: optionalString,
  mail: optionalString,
  userPrincipalName: optionalString,
  accountEnabled: optionalBoolean,
  givenName: optionalString,
  surname: optionalString,
  userType: optionalString,
  "@removed": Schema.optional(RemovedReason),
});

/** A user returned by `/users/delta`. */
export type GraphUser = {
  readonly id: string;
  readonly displayName?: string;
  readonly mail?: string;
  readonly userPrincipalName?: string;
  readonly accountEnabled?: boolean;
  readonly givenName?: string;
  readonly surname?: string;
  readonly userType?: string;
  /** Present when the user was removed from (or changed in) the directory. */
  readonly removed?: boolean;
};

export function graphUserFromWire(user: typeof GraphUserWire.Type): GraphUser {
  const reason: RemovedReason | undefined = user["@removed"];

  return {
    id: user.id,
    displayName: user.displayName ?? undefined,
    mail: user.mail ?? undefined,
    userPrincipalName: user.userPrincipalName ?? undefined,
    accountEnabled: user.accountEnabled ?? undefined,
    givenName: user.givenName ?? undefined,
    surname: user.surname ?? undefined,
    userType: user.userType ?? undefined,
    removed: reason === undefined ? undefined : true,
  };
}

const GraphGroupMemberWire = Schema.Struct({
  id: Schema.String,
  "@odata.type": Schema.optional(Schema.NullOr(Schema.String)),
  "@removed": Schema.optional(RemovedReason),
});

/** A membership change returned inside a group's `members@delta`. */
export type GraphGroupMember = {
  readonly id: string;
  /** Graph object type without the `#microsoft.graph.` prefix, e.g. `user`. */
  readonly type: string;
  /** Present when the member was removed from the group. */
  readonly removed?: boolean;
};

function memberType(type: string | null | undefined): string {
  if (!type) return "unknown";

  return type.replace(/^#microsoft\.graph\./, "");
}

export function graphGroupMemberFromWire(
  member: typeof GraphGroupMemberWire.Type,
): GraphGroupMember {
  return {
    id: member.id,
    type: memberType(member["@odata.type"]),
    removed: member["@removed"] === undefined ? undefined : true,
  };
}

const GraphGroupWire = Schema.Struct({
  id: Schema.String,
  displayName: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  "members@delta": Schema.optional(Schema.NullOr(Schema.Array(GraphGroupMemberWire))),
  "@removed": Schema.optional(RemovedReason),
});

/** A group returned by `/groups/delta`. */
export type GraphGroup = {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly members?: ReadonlyArray<GraphGroupMember>;
  /** Present when the group was removed from (or changed in) the directory. */
  readonly removed?: boolean;
};

export function graphGroupFromWire(group: typeof GraphGroupWire.Type): GraphGroup {
  const members = group["members@delta"];

  return {
    id: group.id,
    displayName: group.displayName ?? "",
    description: group.description ?? undefined,
    members:
      members === undefined || members === null ? undefined : members.map(graphGroupMemberFromWire),
    removed: group["@removed"] === undefined ? undefined : true,
  };
}

/** A domain owned by the Entra tenant. */
export const GraphDomainSchema = Schema.Struct({
  id: Schema.String,
  isVerified: Schema.Boolean,
  isDefault: Schema.Boolean,
  isInitial: Schema.Boolean,
});

export type GraphDomain = typeof GraphDomainSchema.Type;

export const GraphUserDeltaResponse = Schema.Struct({
  value: Schema.optional(Schema.Array(GraphUserWire)),
  "@odata.nextLink": Schema.optional(Schema.NullOr(Schema.String)),
  "@odata.deltaLink": Schema.optional(Schema.NullOr(Schema.String)),
});

export type GraphUserDeltaResponse = typeof GraphUserDeltaResponse.Type;

export const GraphGroupDeltaResponse = Schema.Struct({
  value: Schema.optional(Schema.Array(GraphGroupWire)),
  "@odata.nextLink": Schema.optional(Schema.NullOr(Schema.String)),
  "@odata.deltaLink": Schema.optional(Schema.NullOr(Schema.String)),
});

export type GraphGroupDeltaResponse = typeof GraphGroupDeltaResponse.Type;

export const GraphDomainsResponse = Schema.Struct({
  value: Schema.Array(GraphDomainSchema),
  "@odata.nextLink": Schema.optional(Schema.NullOr(Schema.String)),
});

export type GraphDomainsResponse = typeof GraphDomainsResponse.Type;

/**
 * One page of a Graph delta query. Pass `nextLink` back into the same delta
 * method until it is `null`; persist `deltaLink` for the next sync.
 */
export type GraphDeltaPage<T> = {
  readonly items: ReadonlyArray<T>;
  readonly nextLink: string | null;
  readonly deltaLink: string | null;
};

/** One page of a plain (non-delta) Graph collection. */
export type GraphPage<T> = {
  readonly items: ReadonlyArray<T>;
  readonly nextLink: string | null;
};

/** Normalised Autopilot deployment-profile assignment state. */
export type GraphAutopilotProfileStatus =
  | "unknown"
  | "assigned"
  | "applying"
  | "succeeded"
  | "failed";

/** Normalised Autopilot device enrollment state. */
export type GraphAutopilotEnrollmentState =
  | "unknown"
  | "notEnrolled"
  | "enrolled"
  | "pendingReset"
  | "failed"
  | "blocked";

const AutopilotDeviceWire = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.String)),
  serialNumber: optionalString,
  hardwareIdentifier: optionalString,
  groupTag: optionalString,
  model: optionalString,
  manufacturer: optionalString,
  /** Current Graph name; older responses use `azureActiveDirectoryDeviceId`. */
  azureADDeviceId: optionalString,
  azureActiveDirectoryDeviceId: optionalString,
  managedDeviceId: optionalString,
  displayName: optionalString,
  enrollmentState: optionalString,
  deploymentProfileAssignmentStatus: optionalString,
  deploymentProfileAssignmentDetailedStatus: optionalString,
  deploymentProfileAssignedDateTime: optionalString,
  lastContactedDateTime: optionalString,
  purchaseOrderIdentifier: optionalString,
  resourceName: optionalString,
  systemFamily: optionalString,
  skuNumber: optionalString,
});

type AutopilotDeviceWire = typeof AutopilotDeviceWire.Type;

/** A Windows Autopilot device identity returned by Microsoft Graph. */
export type GraphAutopilotDevice = {
  readonly id: string;
  readonly serialNumber?: string;
  /** Base64 hardware hash, when Graph returns it (list responses omit it). */
  readonly hardwareHash?: string;
  readonly groupTag?: string;
  readonly model?: string;
  readonly manufacturer?: string;
  readonly azureAdDeviceId?: string;
  readonly managedDeviceId?: string;
  readonly displayName?: string;
  readonly enrollmentState: GraphAutopilotEnrollmentState;
  readonly profileStatus: GraphAutopilotProfileStatus;
  readonly profileStatusDetail?: string;
  readonly profileAssignedAt?: string;
  readonly lastContactedAt?: string;
  readonly purchaseOrderIdentifier?: string;
  readonly resourceName?: string;
  readonly systemFamily?: string;
  readonly skuNumber?: string;
};

function normalizeProfileStatus(value: string | null | undefined): GraphAutopilotProfileStatus {
  switch (value?.trim().toLowerCase()) {
    case "assignedinsync":
      return "assigned";
    case "assignednotinsync":
      return "applying";
    case "assignedunprocessed":
      return "assigned";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "unknown":
      return "unknown";
    default:
      return value?.trim() ? "unknown" : "unknown";
  }
}

function normalizeEnrollmentState(value: string | null | undefined): GraphAutopilotEnrollmentState {
  switch (value?.trim().toLowerCase()) {
    case "enrolled":
      return "enrolled";
    case "pendingreset":
      return "pendingReset";
    case "failed":
      return "failed";
    case "blocked":
      return "blocked";
    case "notcontacted":
    case "notenrolled":
      return "notEnrolled";
    case "unknown":
    default:
      return value?.trim() ? "unknown" : "unknown";
  }
}

export function graphAutopilotDeviceFromWire(
  device: typeof AutopilotDeviceWire.Type,
): GraphAutopilotDevice {
  return {
    id: device.id ?? "",
    serialNumber: device.serialNumber ?? undefined,
    hardwareHash: device.hardwareIdentifier ?? undefined,
    groupTag: device.groupTag ?? undefined,
    model: device.model ?? undefined,
    manufacturer: device.manufacturer ?? undefined,
    azureAdDeviceId: device.azureADDeviceId ?? device.azureActiveDirectoryDeviceId ?? undefined,
    managedDeviceId: device.managedDeviceId ?? undefined,
    displayName: device.displayName ?? undefined,
    enrollmentState: normalizeEnrollmentState(device.enrollmentState),
    profileStatus: normalizeProfileStatus(device.deploymentProfileAssignmentStatus),
    profileStatusDetail: device.deploymentProfileAssignmentDetailedStatus ?? undefined,
    profileAssignedAt: device.deploymentProfileAssignedDateTime ?? undefined,
    lastContactedAt: device.lastContactedDateTime ?? undefined,
    purchaseOrderIdentifier: device.purchaseOrderIdentifier ?? undefined,
    resourceName: device.resourceName ?? undefined,
    systemFamily: device.systemFamily ?? undefined,
    skuNumber: device.skuNumber ?? undefined,
  };
}

const AutopilotProfileWire = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.String)),
  displayName: optionalString,
  description: optionalString,
  deploymentMode: optionalString,
  joinType: optionalString,
  deviceNameTemplate: optionalString,
  locale: optionalString,
  language: optionalString,
  enableWhiteGlove: optionalBoolean,
  lastModifiedDateTime: optionalString,
  createdDateTime: optionalString,
});

type AutopilotProfileWire = typeof AutopilotProfileWire.Type;

/** A Windows Autopilot deployment profile returned by Microsoft Graph. */
export type GraphAutopilotProfile = {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly deploymentMode?: string;
  readonly joinType?: string;
  readonly deviceNameTemplate?: string;
  readonly locale?: string;
  readonly enableDevicePreparation: boolean;
  readonly lastModifiedAt?: string;
  readonly createdAt?: string;
};

export function graphAutopilotProfileFromWire(
  profile: typeof AutopilotProfileWire.Type,
): GraphAutopilotProfile {
  return {
    id: profile.id ?? "",
    displayName: profile.displayName ?? "",
    description: profile.description ?? undefined,
    deploymentMode: profile.deploymentMode ?? undefined,
    joinType: profile.joinType ?? undefined,
    deviceNameTemplate: profile.deviceNameTemplate ?? undefined,
    locale: profile.locale ?? profile.language ?? undefined,
    enableDevicePreparation: profile.enableWhiteGlove ?? false,
    lastModifiedAt: profile.lastModifiedDateTime ?? undefined,
    createdAt: profile.createdDateTime ?? undefined,
  };
}

export const GraphAutopilotDevicesResponse = Schema.Struct({
  value: Schema.optional(Schema.Array(AutopilotDeviceWire)),
  "@odata.nextLink": Schema.optional(Schema.NullOr(Schema.String)),
});

export type GraphAutopilotDevicesResponse = typeof GraphAutopilotDevicesResponse.Type;

export const GraphAutopilotDeviceResponse = AutopilotDeviceWire;

export const GraphAutopilotProfilesResponse = Schema.Struct({
  value: Schema.optional(Schema.Array(AutopilotProfileWire)),
  "@odata.nextLink": Schema.optional(Schema.NullOr(Schema.String)),
});

export type GraphAutopilotProfilesResponse = typeof GraphAutopilotProfilesResponse.Type;

export const GraphAutopilotProfileResponse = AutopilotProfileWire;

/**
 * Graph's import endpoint returns the created imported identity, but some
 * tenant configurations wrap it in a collection. Accept both shapes.
 */
export const GraphAutopilotImportResponse = Schema.Union([
  Schema.Struct({ value: Schema.Array(AutopilotDeviceWire) }),
  AutopilotDeviceWire,
]);

export type GraphAutopilotImportResponse = typeof GraphAutopilotImportResponse.Type;

export function importedAutopilotDevices(
  response: GraphAutopilotImportResponse,
): ReadonlyArray<GraphAutopilotDevice> {
  if ("value" in response) return response.value.map(graphAutopilotDeviceFromWire);

  return [graphAutopilotDeviceFromWire(response)];
}
