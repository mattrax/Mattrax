import { Option, Schema } from "effect";

/**
 * Windows device-management actions that are not plain Apple-style commands:
 * Fresh Start, diagnostic archives, Windows LAPS and BitLocker escrow.
 *
 * The helpers here are deliberately pure so capability decisions, CSP payloads
 * and validation can be fixture-tested without a Windows device. Microsoft's
 * CSPs are the protocol; the platform gates below mirror what those documents
 * require.
 */

/** CleanPC was added in Windows 10 1703. */
export const WINDOWS_FRESH_START_MIN_BUILD = 15063;

/** DiagnosticArchive was added in Windows 10 1903. */
export const WINDOWS_DIAGNOSTICS_MIN_BUILD = 18362;

/** RotateRecoveryPasswords was added in Windows 10 1909. */
export const WINDOWS_BITLOCKER_ROTATION_MIN_BUILD = 18363;

/**
 * The Windows LAPS CSP is only serviced by Windows 11 22H2 (22621, with the
 * March 2023 update) and later, or Windows Server 2025 (26100). Windows 10
 * received a backport, but this product only claims the versions Microsoft
 * documents as the current LAPS baseline.
 */
export const WINDOWS_LAPS_MIN_BUILD = 22621;

export const WINDOWS_DIAGNOSTICS_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** Workers buffer the upload, so the CSP archive must stay bounded. */
export const WINDOWS_DIAGNOSTICS_MAX_BYTES = 64 * 1024 * 1024;

/** A key captured longer ago than this is reported as stale. */
export const WINDOWS_BITLOCKER_KEY_STALE_DAYS = 180;

/** Cache window for the metadata-only BitLocker key list. */
export const WINDOWS_BITLOCKER_SYNC_TTL_MS = 10 * 60 * 1000;

export const WINDOWS_LAPS_CONFIGURATION_KIND = "mttx.windows.laps";

export const WINDOWS_LAPS_BACKUP_DIRECTORY_URI =
  "./Device/Vendor/MSFT/LAPS/Policies/BackupDirectory";

export const WINDOWS_LAPS_RESET_PASSWORD_URI =
  "./Device/Vendor/MSFT/LAPS/Actions/ResetPassword";

export const WINDOWS_LAPS_RESET_PASSWORD_STATUS_URI =
  "./Device/Vendor/MSFT/LAPS/Actions/ResetPasswordStatus";

export const WINDOWS_BITLOCKER_ROTATE_URI =
  "./Device/Vendor/MSFT/BitLocker/RotateRecoveryPasswords";

export const WINDOWS_BITLOCKER_ROTATE_STATUS_URI =
  "./Device/Vendor/MSFT/BitLocker/Status/RotateRecoveryPasswordsStatus";

export const WINDOWS_DIAGNOSTICS_ARCHIVE_URI =
  "./Vendor/MSFT/DiagnosticLog/DiagnosticArchive/ArchiveDefinition";

export const WINDOWS_DIAGNOSTICS_RESULTS_URI =
  "./Vendor/MSFT/DiagnosticLog/DiagnosticArchive/ArchiveResults";

/** Build number from osBuild or the last component of osVersion ("10.0.22631"). */
export const windowsBuildNumber = (
  osVersion: string | null | undefined,
  osBuild?: string | null,
): number | null => {
  const build = osBuild?.trim() || osVersion?.trim();

  if (!build) return null;

  const match = /(\d+)(?:\.\d+)?\s*$/.exec(build);

  if (!match) return null;
  const parsed = Number(match[1]);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export type WindowsVersionInput = {
  readonly proto?: string | null;
  readonly osVersion?: string | null;
  readonly osBuild?: string | null;
};

const windowsBuildSupported = (input: WindowsVersionInput, minimum: number): boolean =>
  input.proto === "win" &&
  (windowsBuildNumber(input.osVersion, input.osBuild) ?? 0) >= minimum;

/** CleanPC is an Enterprise/Education feature, not Pro or Home. */
export const windowsFreshStartEditionSupported = (osEdition: string | null | undefined): boolean =>
  /enterprise|education|iot\s*enterprise/i.test(osEdition ?? "");

export const windowsFreshStartSupported = (
  input: WindowsVersionInput & { readonly osEdition?: string | null },
): boolean =>
  windowsBuildSupported(input, WINDOWS_FRESH_START_MIN_BUILD) &&
  windowsFreshStartEditionSupported(input.osEdition);

export const windowsDiagnosticsSupported = (input: WindowsVersionInput): boolean =>
  windowsBuildSupported(input, WINDOWS_DIAGNOSTICS_MIN_BUILD);

export const windowsLapsSupported = (input: WindowsVersionInput): boolean =>
  windowsBuildSupported(input, WINDOWS_LAPS_MIN_BUILD);

export const windowsBitlockerRotationSupported = (
  input: WindowsVersionInput & {
    readonly bitLockerEnabled?: boolean | null;
    readonly entraDeviceId?: string | null;
    readonly domainName?: string | null;
  },
): boolean =>
  windowsBuildSupported(input, WINDOWS_BITLOCKER_ROTATION_MIN_BUILD) &&
  input.bitLockerEnabled === true &&
  // A plain AD-domain join has no Entra recovery-key store and cannot use the
  // CSP's Entra rotation path. Hybrid joins report an Entra device id too.
  Boolean(input.entraDeviceId?.trim());

export const WINDOWS_FRESH_START_MODES = ["retain-user-data", "remove-user-data"] as const;

export const WindowsFreshStartMode = Schema.Literals(WINDOWS_FRESH_START_MODES);

export type WindowsFreshStartMode = typeof WindowsFreshStartMode.Type;

export const WINDOWS_FRESH_START_MODE_LABELS: Record<WindowsFreshStartMode, string> = {
  "retain-user-data": "Keep user files",
  "remove-user-data": "Remove everything",
};

export type WindowsCspCommand = {
  readonly locURI: string;
  readonly data: string;
  readonly format: string;
};

/**
 * CleanPC executes immediately when the CSP receives 1, which is the only
 * supported operation. Retaining user data still removes OEM and user-installed
 * apps; removing it returns the device to OOBE.
 */
export const windowsFreshStartCommand = (mode: WindowsFreshStartMode): WindowsCspCommand => ({
  locURI:
    mode === "retain-user-data"
      ? "./Device/Vendor/MSFT/CleanPC/CleanPCRetainingUserData"
      : "./Device/Vendor/MSFT/CleanPC/CleanPCWithoutRetainingUserData",
  data: "1",
  format: "int",
});

const xmlEscape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

/**
 * The DiagnosticArchive Collection XML. Only Microsoft's allow-listed command
 * and folder roots are used: this is a support bundle, not a scripting channel.
 * The upload URL carries a scoped, short-lived write token and never a tenant
 * session.
 */
export const windowsDiagnosticsCollectionXml = (input: {
  readonly collectionId: string;
  readonly uploadUrl: string;
}): string => {
  const upload = new URL(input.uploadUrl);

  if (upload.protocol !== "https:") throw new Error("The diagnostic upload URL must use HTTPS.");

  return [
    '<?xml version="1.0"?>',
    "<Collection>",
    "<ID>" + xmlEscape(input.collectionId) + "</ID>",
    "<SasUrl><![CDATA[" + input.uploadUrl.replaceAll("]]>", "]]]]><![CDATA[>") + "]]></SasUrl>",
    String.raw`<RegistryKey>HKLM\Software\Policies</RegistryKey>`,
    String.raw`<RegistryKey>HKLM\Software\Microsoft\Enrollments</RegistryKey>`,
    "<Events>Application</Events>",
    "<Events>System</Events>",
    "<Events>Microsoft-Windows-DeviceManagement-Enterprise-Diagnostics-Provider/Admin</Events>",
    String.raw`<Command>%windir%\system32\MdmDiagnosticsTool.exe -out %ProgramData%\temp\</Command>`,
    String.raw`<FoldersFiles>%ProgramData%\temp\*.*</FoldersFiles>`,
    String.raw`<FoldersFiles>%ProgramData%\Microsoft\DiagnosticLogCSP\Collectors\*.etl</FoldersFiles>`,
    "<OutputFileFormat>Flattened</OutputFileFormat>",
    "</Collection>",
  ].join("");
};

export const windowsDiagnosticsCommand = (input: {
  readonly collectionId: string;
  readonly uploadUrl: string;
}): WindowsCspCommand => ({
  locURI: WINDOWS_DIAGNOSTICS_ARCHIVE_URI,
  data: windowsDiagnosticsCollectionXml(input),
  format: "chr",
});

/** Request ID is an opaque GUID the CSP echoes in its status nodes. */
export const windowsBitlockerRotateCommand = (requestId: string): WindowsCspCommand => {
  if (!requestId.trim()) throw new Error("A BitLocker rotation request id is required.");

  return { locURI: WINDOWS_BITLOCKER_ROTATE_URI, data: requestId.trim(), format: "chr" };
};

export const windowsLapsResetCommand = (): WindowsCspCommand => ({
  locURI: WINDOWS_LAPS_RESET_PASSWORD_URI,
  data: "",
  format: "null",
});

export const windowsLapsResetStatusGet = (): WindowsCspCommand => ({
  locURI: WINDOWS_LAPS_RESET_PASSWORD_STATUS_URI,
  data: "",
  format: "int",
});

export const windowsBitlockerRotateStatusGet = (): WindowsCspCommand => ({
  locURI: WINDOWS_BITLOCKER_ROTATE_STATUS_URI,
  data: "",
  format: "int",
});

// ---------------------------------------------------------------------------
// Windows LAPS policy
// ---------------------------------------------------------------------------

export const WINDOWS_LAPS_BACKUP_DIRECTORIES = ["disabled", "entra-id", "active-directory"] as const;

export const WindowsLapsBackupDirectory = Schema.Literals(WINDOWS_LAPS_BACKUP_DIRECTORIES);

export type WindowsLapsBackupDirectory = typeof WindowsLapsBackupDirectory.Type;

const WINDOWS_LAPS_BACKUP_DIRECTORY_VALUES: Record<WindowsLapsBackupDirectory, 0 | 1 | 2> = {
  disabled: 0,
  "entra-id": 1,
  "active-directory": 2,
};

export const WINDOWS_LAPS_POST_AUTHENTICATION_ACTIONS = [1, 3, 5, 11] as const;

export const WindowsLapsPolicy = Schema.Struct({
  /** The account Windows manages; omitted means the built-in administrator. */
  accountName: Schema.optional(Schema.NullOr(Schema.String)),
  backupDirectory: WindowsLapsBackupDirectory,
  passwordAgeDays: Schema.optional(Schema.NullOr(Schema.Number)),
  passwordLength: Schema.optional(Schema.NullOr(Schema.Number)),
  passwordComplexity: Schema.optional(Schema.NullOr(Schema.Number)),
  passphraseLength: Schema.optional(Schema.NullOr(Schema.Number)),
  postAuthenticationActions: Schema.optional(Schema.NullOr(Schema.Number)),
  postAuthenticationResetDelayHours: Schema.optional(Schema.NullOr(Schema.Number)),
  passwordExpirationProtection: Schema.optional(Schema.NullOr(Schema.Boolean)),
});

export type WindowsLapsPolicy = typeof WindowsLapsPolicy.Type;

const integerInRange = (
  value: number | null | undefined,
  minimum: number,
  maximum: number,
): boolean =>
  value === null ||
  value === undefined ||
  (Number.isInteger(value) && value >= minimum && value <= maximum);

/** Why a LAPS policy cannot be delivered, in operator-facing wording. */
export const windowsLapsPolicyProblem = (policy: WindowsLapsPolicy): string | undefined => {
  const accountName = policy.accountName?.trim();

  if (accountName && (accountName.length > 60 || /[\\/:]/.test(accountName)))
    return "The managed account name must be 1-60 characters and cannot contain a slash, colon or backslash.";

  if (!integerInRange(policy.passwordAgeDays, 1, 365))
    return "The password age must be between 1 and 365 days.";

  if (policy.backupDirectory === "entra-id" && (policy.passwordAgeDays ?? 30) < 7)
    return "Entra ID-backed Windows LAPS requires a password age of at least 7 days.";

  if (!integerInRange(policy.passwordLength, 8, 64))
    return "The password length must be between 8 and 64 characters.";

  const complexity = policy.passwordComplexity ?? 4;

  if (!Number.isInteger(complexity) || complexity < 1 || complexity > 8)
    return "Choose a documented password complexity from 1 to 8.";

  // Passphrase complexity and PassphraseLength are Windows 11 24H2+ only.
  // The supported LAPS baseline in this product is 22H2 (22621), so a policy
  // that would emit 24H2-only nodes is rejected rather than silently ignored.
  if (complexity >= 6)
    return "Passphrase complexity (6-8) requires Windows 11 24H2 or later. Use complexity 1-5 on the supported 22H2 baseline.";

  if (
    policy.postAuthenticationActions !== null &&
    policy.postAuthenticationActions !== undefined &&
    !(WINDOWS_LAPS_POST_AUTHENTICATION_ACTIONS as ReadonlyArray<number>).includes(
      policy.postAuthenticationActions,
    )
  )
    return "Choose one of Windows LAPS's documented post-authentication actions (1, 3, 5 or 11).";

  if (!integerInRange(policy.postAuthenticationResetDelayHours, 0, 24))
    return "The post-authentication delay must be between 0 and 24 hours.";

  return undefined;
};

export type WindowsCspPolicyNode = {
  readonly omaUri: string;
  readonly value: Schema.Json;
  readonly format: string;
};

/**
 * Compile the structured LAPS policy to the documented CSP nodes. Not every
 * node is sent: only the fields the operator set, plus the required backup
 * directory, so unset values keep the Windows default.
 */
export const windowsLapsPolicyNodes = (
  policy: WindowsLapsPolicy,
): ReadonlyArray<WindowsCspPolicyNode> => {
  const nodes: Array<WindowsCspPolicyNode> = [
    {
      omaUri: WINDOWS_LAPS_BACKUP_DIRECTORY_URI,
      value: WINDOWS_LAPS_BACKUP_DIRECTORY_VALUES[policy.backupDirectory],
      format: "int",
    },
  ];

  const accountName = policy.accountName?.trim();

  if (accountName)
    nodes.push({
      omaUri: "./Device/Vendor/MSFT/LAPS/Policies/AdministratorAccountName",
      value: accountName,
      format: "chr",
    });

  const addNumber = (name: string, value: number | null | undefined) => {
    if (value !== null && value !== undefined)
      nodes.push({ omaUri: "./Device/Vendor/MSFT/LAPS/Policies/" + name, value, format: "int" });
  };

  addNumber("PasswordAgeDays", policy.passwordAgeDays);
  // PasswordLength and PassphraseLength have mutually exclusive CSP
  // dependencies on PasswordComplexity. Sending the wrong one makes Windows
  // reject the whole policy, so only the applicable node is emitted.
  const complexity = policy.passwordComplexity ?? 4;

  // Passphrase settings are 24H2-only. A policy is rejected by
  // `windowsLapsPolicyProblem` on the 22H2 baseline; if older stored data
  // still contains one, omit it rather than delivering a setting Windows
  // would reject (Windows keeps its default complexity).
  if (complexity < 6) {
    addNumber("PasswordComplexity", policy.passwordComplexity);
    addNumber("PasswordLength", policy.passwordLength);
  }
  addNumber("PostAuthenticationActions", policy.postAuthenticationActions);
  addNumber("PostAuthenticationResetDelay", policy.postAuthenticationResetDelayHours);

  // The CSP ignores this outside an AD backup, and sending it with an Entra
  // policy only creates a misleading delivered setting.
  if (
    policy.backupDirectory === "active-directory" &&
    policy.passwordExpirationProtection !== null &&
    policy.passwordExpirationProtection !== undefined
  )
    nodes.push({
      omaUri: "./Device/Vendor/MSFT/LAPS/Policies/PasswordExpirationProtectionEnabled",
      value: policy.passwordExpirationProtection,
      format: "bool",
    });

  return nodes;
};

/** Tolerant decode for stored policy data; invalid data returns undefined. */
export const parseWindowsLapsPolicy = (value: unknown): WindowsLapsPolicy | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(WindowsLapsPolicy)(value));

export type WindowsLapsNodeSource = {
  readonly policyId: string;
  readonly kind: string;
  readonly data: Schema.Json | undefined;
};

export type ResolvedWindowsLapsConfiguration = WindowsLapsPolicy & {
  readonly configured: true;
  readonly policyId?: string;
};

const policyDataNodes = (data: Schema.Json | undefined): ReadonlyArray<WindowsCspPolicyNode> => {
  if (!Schema.is(Schema.JsonObject)(data)) return [];

  const rawNodes = Array.isArray(data["nodes"]) ? data["nodes"] : [data];
  const nodes: Array<WindowsCspPolicyNode> = [];

  for (const raw of rawNodes) {
    if (!Schema.is(Schema.JsonObject)(raw)) continue;
    const omaUri = raw["omaUri"];

    if (!Schema.is(Schema.String)(omaUri)) continue;

    nodes.push({
      omaUri,
      value: (raw["value"] ?? null) as Schema.Json,
      format: Schema.is(Schema.String)(raw["format"]) ? raw["format"] : "chr",
    });
  }

  return nodes;
};

const numericNode = (value: Schema.Json | undefined): number | undefined => {
  if (Schema.is(Schema.Number)(value) && Number.isFinite(value)) return value;

  if (Schema.is(Schema.String)(value) && value.trim() && Number.isFinite(Number(value)))
    return Number(value);

  return undefined;
};

const booleanNode = (value: Schema.Json | undefined): boolean | undefined => {
  if (Schema.is(Schema.Boolean)(value)) return value;

  if (Schema.is(Schema.String)(value)) {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true" || normalized === "1") return true;

    if (normalized === "false" || normalized === "0") return false;
  }

  if (Schema.is(Schema.Number)(value) && (value === 0 || value === 1)) return value === 1;

  return undefined;
};

/**
 * Resolve the effective LAPS settings from every policy configuration assigned
 * to a device. The first policy id wins per OMA-URI, matching Windows policy
 * delivery. Both the structured kind and raw mttx.windows.custom.* nodes are
 * accepted, so an existing LAPS policy does not have to be re-authored.
 */
export const resolveWindowsLapsConfiguration = (
  configurations: ReadonlyArray<WindowsLapsNodeSource>,
): ResolvedWindowsLapsConfiguration | undefined => {
  const sorted = [...configurations].sort((left, right) =>
    left.policyId.localeCompare(right.policyId),
  );
  const nodes = new Map<string, Schema.Json>();
  let policyId: string | undefined;

  for (const configuration of sorted) {
    const structured =
      configuration.kind === WINDOWS_LAPS_CONFIGURATION_KIND
        ? parseWindowsLapsPolicy(configuration.data)
        : undefined;

    const source = structured
      ? windowsLapsPolicyNodes(structured)
      : policyDataNodes(configuration.data);

    for (const node of source) {
      if (nodes.has(node.omaUri)) continue;

      nodes.set(node.omaUri, node.value);
      policyId ??= configuration.policyId;
    }
  }

  const backupValue = numericNode(nodes.get(WINDOWS_LAPS_BACKUP_DIRECTORY_URI));

  if (backupValue === undefined || ![0, 1, 2].includes(backupValue)) return undefined;

  const backupDirectory: WindowsLapsBackupDirectory =
    backupValue === 1 ? "entra-id" : backupValue === 2 ? "active-directory" : "disabled";

  const textNode = (name: string): string | undefined => {
    const value = nodes.get("./Device/Vendor/MSFT/LAPS/Policies/" + name);

    return Schema.is(Schema.String)(value) && value.trim() ? value.trim() : undefined;
  };

  return {
    configured: true,
    policyId,
    backupDirectory,
    accountName: textNode("AdministratorAccountName") ?? null,
    passwordAgeDays:
      numericNode(nodes.get("./Device/Vendor/MSFT/LAPS/Policies/PasswordAgeDays")) ?? null,
    passwordLength:
      numericNode(nodes.get("./Device/Vendor/MSFT/LAPS/Policies/PasswordLength")) ?? null,
    passwordComplexity:
      numericNode(nodes.get("./Device/Vendor/MSFT/LAPS/Policies/PasswordComplexity")) ?? null,
    passphraseLength:
      numericNode(nodes.get("./Device/Vendor/MSFT/LAPS/Policies/PassphraseLength")) ?? null,
    postAuthenticationActions:
      numericNode(nodes.get("./Device/Vendor/MSFT/LAPS/Policies/PostAuthenticationActions")) ??
      null,
    postAuthenticationResetDelayHours:
      numericNode(nodes.get("./Device/Vendor/MSFT/LAPS/Policies/PostAuthenticationResetDelay")) ??
      null,
    passwordExpirationProtection:
      booleanNode(
        nodes.get("./Device/Vendor/MSFT/LAPS/Policies/PasswordExpirationProtectionEnabled"),
      ) ?? null,
  };
};

// ---------------------------------------------------------------------------
// BitLocker escrow and health
// ---------------------------------------------------------------------------

export const BITLOCKER_KEY_TYPES = ["numeric-password", "recovery-password"] as const;

export const BitlockerKeyType = Schema.Literals(BITLOCKER_KEY_TYPES);

export type BitlockerKeyType = typeof BitlockerKeyType.Type;

export const BITLOCKER_VOLUME_TYPES = [
  "operating-system",
  "fixed-data",
  "removable-data",
] as const;

export const BitlockerVolumeType = Schema.Literals(BITLOCKER_VOLUME_TYPES);

export type BitlockerVolumeType = typeof BitlockerVolumeType.Type;

/** Map Graph's numeric/string volumeType onto our stable token. */
export const bitlockerVolumeTypeFromGraph = (
  value: string | number | null | undefined,
): "operating-system" | "fixed-data" | "removable-data" => {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (
    normalized === "1" ||
    normalized === "operatingsystemvolume" ||
    normalized === "operating-system"
  )
    return "operating-system";

  if (normalized === "2" || normalized === "fixeddatavolume" || normalized === "fixed-data")
    return "fixed-data";

  return "removable-data";
};

export type BitlockerKeyHealth = "fresh" | "stale";

export type BitlockerKeyHealthResult = {
  readonly ageDays: number;
  readonly health: BitlockerKeyHealth;
};

export const bitlockerKeyHealth = (input: {
  readonly capturedAt: Date | string;
  readonly now: Date;
  readonly staleAfterDays?: number;
}): BitlockerKeyHealthResult => {
  const captured = input.capturedAt instanceof Date ? input.capturedAt : new Date(input.capturedAt);
  const ageMs = Number.isFinite(captured.getTime())
    ? Math.max(0, input.now.getTime() - captured.getTime())
    : Number.POSITIVE_INFINITY;
  const ageDays = Number.isFinite(ageMs) ? Math.floor(ageMs / 86_400_000) : Number.MAX_SAFE_INTEGER;
  const threshold = input.staleAfterDays ?? WINDOWS_BITLOCKER_KEY_STALE_DAYS;

  return { ageDays, health: ageDays >= threshold ? "stale" : "fresh" };
};

export type WindowsRotationStatusKind = "pending" | "succeeded" | "failed" | "unknown";

/**
 * BitLocker `RotateRecoveryPasswordsStatus` is a small enum, not an HRESULT:
 * 0 Pass, 1 Pending, 2 NotStarted, anything else a failure. Both Pending and
 * NotStarted are non-terminal and must be polled.
 */
export const windowsBitlockerRotationStatusKind = (
  value: string | null | undefined,
): WindowsRotationStatusKind => {
  const text = value?.trim().toLowerCase();

  if (!text) return "unknown";
  if (text === "0" || text === "0x0") return "succeeded";
  if (text === "1" || text === "2") return "pending";

  return "failed";
};

export const windowsBitlockerRotationNeedsPoll = (
  value: string | null | undefined,
): boolean => windowsBitlockerRotationStatusKind(value) === "pending";

/**
 * LAPS `ResetPasswordStatus` is an HRESULT. E_PENDING is 0x8000000A (also
 * seen as its signed/unsigned decimal forms). 0x80000000 is E_FAIL and must
 * not be polled for 24 hours.
 */
export const windowsLapsResetStatusKind = (
  value: string | null | undefined,
): WindowsRotationStatusKind => {
  const text = value?.trim().toLowerCase();

  if (!text) return "unknown";
  if (text === "0" || text === "0x0" || text === "s_ok") return "succeeded";

  if (
    text === "0x8000000a" ||
    text === "2147483658" ||
    text === "-2147483638"
  )
    return "pending";

  return "failed";
};

export const windowsLapsResetNeedsPoll = (value: string | null | undefined): boolean =>
  windowsLapsResetStatusKind(value) === "pending";

/**
 * Whether the next check-in should queue another status Get. The first poll is
 * queued when no status row exists; later polls stop on terminal success or
 * failure, and a 24-hour deadline stops a permanently failing device.
 *
 * Only an acknowledged Exec is polled: `accepted` (Windows acknowledged an
 * asynchronous command with DM_S_ACCEPTED_FOR_PROCESSING) or `succeeded`.
 * A server-`queued` or merely `sent` Exec has no device result yet, so the
 * first status Get must wait for a later check-in.
 */
export const windowsRotationPollDecision = (input: {
  readonly kind: "laps" | "bitlocker";
  readonly execStatus: string;
  readonly latestStatusDetail: string | null | undefined;
  readonly now: Date;
  readonly execUpdatedAt: Date;
  /** Maximum time to keep polling after the Exec was acknowledged. */
  readonly pollForMs?: number;
}): "poll" | "stop" => {
  if (input.execStatus !== "succeeded" && input.execStatus !== "accepted") return "stop";

  const deadline =
    input.execUpdatedAt.getTime() + (input.pollForMs ?? 24 * 60 * 60 * 1000);

  if (input.now.getTime() >= deadline) return "stop";

  const value = input.latestStatusDetail?.replace(/^Status /, "").trim() ?? "";

  if (!value) return "poll";

  const needsPoll =
    input.kind === "bitlocker"
      ? windowsBitlockerRotationNeedsPoll(value)
      : windowsLapsResetNeedsPoll(value);

  return needsPoll ? "poll" : "stop";
};

// ---------------------------------------------------------------------------
// API response schemas
// ---------------------------------------------------------------------------

export const DeviceWindowsLapsInfo = Schema.Struct({
  /** Windows 11 22H2/Server 2025 or later. */
  supported: Schema.Boolean,
  /** A LAPS policy applies to this device. */
  configured: Schema.Boolean,
  /** Retrieval needs an Entra-backed password and an Entra device id. */
  retrievable: Schema.Boolean,
  backupDirectory: Schema.optional(Schema.NullOr(WindowsLapsBackupDirectory)),
  accountName: Schema.optional(Schema.NullOr(Schema.String)),
  policyId: Schema.optional(Schema.NullOr(Schema.String)),
  passwordBackedUpAt: Schema.optional(Schema.NullOr(Schema.String)),
  passwordRefreshAt: Schema.optional(Schema.NullOr(Schema.String)),
  passwordExpiresAt: Schema.optional(Schema.NullOr(Schema.String)),
  passwordExpired: Schema.optional(Schema.Boolean),
  passwordAgeDays: Schema.optional(Schema.NullOr(Schema.Number)),
  rotationInProgress: Schema.optional(Schema.Boolean),
  /** Last `ResetPasswordStatus` (or pending) read from the device. */
  resetStatus: Schema.optional(Schema.NullOr(Schema.String)),
  lastError: Schema.optional(Schema.NullOr(Schema.String)),
  /** Why retrieval is unavailable, in operator-facing wording. */
  reason: Schema.optional(Schema.NullOr(Schema.String)),
});

export type DeviceWindowsLapsInfo = typeof DeviceWindowsLapsInfo.Type;

export const DeviceBitlockerKeyInfo = Schema.Struct({
  id: Schema.String,
  volumeType: BitlockerVolumeType,
  keyId: Schema.String,
  keyType: BitlockerKeyType,
  protectorType: Schema.String,
  source: Schema.Literals(["entra-id"]),
  /** True when the sealed key is cached locally; a reveal can fetch it. */
  keyAvailable: Schema.Boolean,
  capturedAt: Schema.String,
  rotatedAt: Schema.optional(Schema.NullOr(Schema.String)),
  reportedAt: Schema.String,
  ageDays: Schema.Number,
  health: Schema.Literals(["fresh", "stale"]),
});

export type DeviceBitlockerKeyInfo = typeof DeviceBitlockerKeyInfo.Type;

export const DeviceBitlockerInfo = Schema.Struct({
  encrypted: Schema.Boolean,
  status: Schema.optional(Schema.NullOr(Schema.Number)),
  /** Entra-joined or hybrid-joined; rotation is only supported for those. */
  joined: Schema.Boolean,
  rotationInProgress: Schema.Boolean,
  rotationStatus: Schema.optional(Schema.NullOr(Schema.String)),
  lastRotationAt: Schema.optional(Schema.NullOr(Schema.String)),
  lastSyncedAt: Schema.optional(Schema.NullOr(Schema.String)),
  syncError: Schema.optional(Schema.NullOr(Schema.String)),
  keys: Schema.Array(DeviceBitlockerKeyInfo),
  /** True when BitLocker is enabled but no recovery key is available. */
  escrowMissing: Schema.Boolean,
  reason: Schema.optional(Schema.NullOr(Schema.String)),
});

export type DeviceBitlockerInfo = typeof DeviceBitlockerInfo.Type;

export const DeviceWindowsSecurityResponse = Schema.Struct({
  platformSupported: Schema.Boolean,
  laps: DeviceWindowsLapsInfo,
  bitlocker: DeviceBitlockerInfo,
});

export type DeviceWindowsSecurityResponse = typeof DeviceWindowsSecurityResponse.Type;

export const DeviceLapsPasswordResponse = Schema.Struct({
  username: Schema.String,
  password: Schema.String,
  accountSid: Schema.optional(Schema.NullOr(Schema.String)),
  backedUpAt: Schema.String,
  expiresAt: Schema.optional(Schema.NullOr(Schema.String)),
  expired: Schema.Boolean,
  ageDays: Schema.Number,
});

export type DeviceLapsPasswordResponse = typeof DeviceLapsPasswordResponse.Type;

export const DeviceBitlockerKeyRevealResponse = Schema.Struct({
  id: Schema.String,
  volumeType: BitlockerVolumeType,
  keyId: Schema.String,
  keyType: BitlockerKeyType,
  protectorType: Schema.String,
  recoveryKey: Schema.String,
  capturedAt: Schema.String,
  ageDays: Schema.Number,
  health: Schema.Literals(["fresh", "stale"]),
});

export type DeviceBitlockerKeyRevealResponse = typeof DeviceBitlockerKeyRevealResponse.Type;

export const DEVICE_DIAGNOSTICS_STATUSES = ["pending", "uploaded", "failed", "expired"] as const;

export const DeviceDiagnosticsStatus = Schema.Literals(DEVICE_DIAGNOSTICS_STATUSES);

export type DeviceDiagnosticsStatus = typeof DeviceDiagnosticsStatus.Type;

export const DeviceDiagnosticsArchiveInfo = Schema.Struct({
  id: Schema.String,
  status: DeviceDiagnosticsStatus,
  requestedAt: Schema.String,
  uploadedAt: Schema.optional(Schema.NullOr(Schema.String)),
  expiresAt: Schema.String,
  sizeBytes: Schema.optional(Schema.NullOr(Schema.Number)),
  /** A short-lived, tenant-scoped download path; absent until uploaded. */
  downloadPath: Schema.optional(Schema.NullOr(Schema.String)),
  error: Schema.optional(Schema.NullOr(Schema.String)),
});

export type DeviceDiagnosticsArchiveInfo = typeof DeviceDiagnosticsArchiveInfo.Type;

export const DeviceDiagnosticsResponse = Schema.Struct({
  supported: Schema.Boolean,
  reason: Schema.optional(Schema.NullOr(Schema.String)),
  archives: Schema.Array(DeviceDiagnosticsArchiveInfo),
});

export type DeviceDiagnosticsResponse = typeof DeviceDiagnosticsResponse.Type;

export const DeviceWindowsSecurityQuery = Schema.Struct({
  reason: Schema.optional(Schema.String),
});

/** Minimum reason length for a BitLocker or LAPS reveal. */
export const WINDOWS_SECRET_REASON_MIN_LENGTH = 5;

export const WINDOWS_SECRET_REASON_MAX_LENGTH = 500;

export const windowsSecretReasonProblem = (value: string | null | undefined): string | undefined => {
  const reason = value?.trim() ?? "";

  if (reason.length < WINDOWS_SECRET_REASON_MIN_LENGTH)
    return "Give a reason for reading this secret so the audit log explains it.";

  if (reason.length > WINDOWS_SECRET_REASON_MAX_LENGTH)
    return "The reason must be at most " + WINDOWS_SECRET_REASON_MAX_LENGTH + " characters.";

  return undefined;
};

/** A friendly command-history label for the new Windows request types. */
export const WINDOWS_COMMAND_REQUEST_LABELS: ReadonlyMap<string, string> = new Map([
  ["WindowsFreshStart", "Fresh Start"],
  ["WindowsCollectDiagnostics", "Collect diagnostics"],
  ["WindowsLapsResetPassword", "Rotate local administrator password"],
  ["WindowsLapsResetPasswordStatus", "Local administrator password status"],
  ["WindowsBitLockerRotate", "Rotate BitLocker recovery keys"],
  ["WindowsBitLockerRotateStatus", "BitLocker rotation status"],
]);

