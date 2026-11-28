import { MigrationId } from "@mattrax/crypto";
import { Schema } from "effect";
import { NullableString } from "./Errors.js";

/**
 * Fleet migration cohorts.
 *
 * Moving a fleet off Jamf, Intune or Kandji means touching every device: the
 * incumbent has to remove its own MDM profile, the device has to re-enrol into
 * Mattrax, and a person has to confirm the user accepted the new profile. This
 * module owns the vocabulary for that workflow.
 *
 * Two rules shape everything here:
 *
 * 1. Mattrax can only act on a device it manages. A device still managed by the
 *    incumbent is unenrolled *from the incumbent's console*, so the cohort's
 *    handoff is a one-shot script the operator deploys there (or queues through
 *    Mattrax when the machine is already ours). No primitive here pretends to
 *    reach a device we cannot reach.
 * 2. Status is evidence, not a promise. Every transition is derived from an
 *    observation (a script result, a device row appearing, a deadline passing)
 *    and is written with the observation in `lastEvidence`.
 */

export const FLEET_MIGRATION_SOURCES = ["jamf", "intune", "kandji", "other"] as const;

export const FleetMigrationSource = Schema.Literals(FLEET_MIGRATION_SOURCES);

export type FleetMigrationSource = typeof FleetMigrationSource.Type;

export const FLEET_MIGRATION_PLATFORMS = ["apple", "win", "android"] as const;

export const FleetMigrationPlatform = Schema.Literals(FLEET_MIGRATION_PLATFORMS);

export type FleetMigrationPlatform = typeof FleetMigrationPlatform.Type;

/**
 * `pending` has not issued an unenrol; `unenrol-issued` is waiting for the
 * handoff to land; `awaiting-enrolment` means the device left the incumbent and
 * Mattrax has not seen it return; `enrolled` means the device record is back;
 * `confirmed` is an operator saying the user accepted the profile; `stuck` is
 * the deadline passing without a return.
 */
export const FLEET_MIGRATION_STATUSES = [
  "pending",
  "unenrol-issued",
  "awaiting-enrolment",
  "enrolled",
  "confirmed",
  "stuck",
] as const;

export const FleetMigrationEntryStatus = Schema.Literals(FLEET_MIGRATION_STATUSES);

export type FleetMigrationEntryStatus = typeof FleetMigrationEntryStatus.Type;

export const FLEET_MIGRATION_STATUS_LABELS: Readonly<Record<FleetMigrationEntryStatus, string>> = {
  pending: "Pending",
  "unenrol-issued": "Unenrol issued",
  "awaiting-enrolment": "Awaiting enrolment",
  enrolled: "Enrolled",
  confirmed: "Confirmed",
  stuck: "Stuck",
};

export const fleetMigrationStatusLabel = (status: FleetMigrationEntryStatus): string =>
  FLEET_MIGRATION_STATUS_LABELS[status];

export const FLEET_MIGRATION_SOURCE_LABELS: Readonly<Record<FleetMigrationSource, string>> = {
  jamf: "Jamf Pro",
  intune: "Microsoft Intune",
  kandji: "Kandji",
  other: "Another MDM",
};

export const fleetMigrationSourceLabel = (source: FleetMigrationSource): string =>
  FLEET_MIGRATION_SOURCE_LABELS[source];

export const platformLabel = (platform: FleetMigrationPlatform): string => {
  switch (platform) {
    case "apple":
      return "Apple";
    case "win":
      return "Windows";
    case "android":
      return "Android";
  }
};

/** A cohort name is an operator label, not an identifier. */
export const FLEET_MIGRATION_NAME_MAX_LENGTH = 120;

/** Serials are uppercase alphanumeric; this rejects pasted spreadsheet noise. */
export const FLEET_MIGRATION_SERIAL_MAX_LENGTH = 64;

export const FLEET_MIGRATION_SERIAL_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;

export const FLEET_MIGRATION_MAX_DEVICES = 5_000;

/** A single issue call never queues more than this, so a click cannot fan out. */
export const FLEET_MIGRATION_UNENROL_BATCH_MAX = 50;

export const FLEET_MIGRATION_UNENROL_BATCH_DEFAULT = 10;

/** Days before a silent device is declared stuck. */
export const FLEET_MIGRATION_STUCK_DAYS_DEFAULT = 7;

export const FLEET_MIGRATION_STUCK_DAYS_MIN = 1;

export const FLEET_MIGRATION_STUCK_DAYS_MAX = 90;

/** Terminal rows are kept; a cohort is a record of a migration, not a queue. */
export const FLEET_MIGRATION_LIST_MAX = 200;

/**
 * Allowed transitions. The machine only moves forward, except that a stale or
 * re-issued cohort may send a device back to the handoff states: an `enrolled`
 * device that disappears again is re-issued, and a `stuck` device is retried.
 */
const TRANSITIONS: Readonly<
  Record<FleetMigrationEntryStatus, ReadonlyArray<FleetMigrationEntryStatus>>
> = {
  pending: ["unenrol-issued", "awaiting-enrolment", "stuck"],
  "unenrol-issued": ["awaiting-enrolment", "enrolled", "stuck", "unenrol-issued"],
  "awaiting-enrolment": ["enrolled", "stuck", "unenrol-issued", "awaiting-enrolment"],
  enrolled: ["confirmed", "unenrol-issued", "awaiting-enrolment", "stuck"],
  // Confirmed is terminal; a correction means editing the device, not the
  // cohort.
  confirmed: [],
  stuck: ["unenrol-issued", "awaiting-enrolment", "enrolled", "confirmed"],
};

export const migrationTransitionAllowed = (
  from: FleetMigrationEntryStatus,
  to: FleetMigrationEntryStatus,
): boolean => TRANSITIONS[from].includes(to);

/** Operator-facing reason a move is impossible, or null when it is allowed. */
export const migrationTransitionProblem = (
  from: FleetMigrationEntryStatus,
  to: FleetMigrationEntryStatus,
): string | null =>
  migrationTransitionAllowed(from, to)
    ? null
    : `A device in "${fleetMigrationStatusLabel(from)}" cannot move to "${fleetMigrationStatusLabel(to)}".`;

/** Statuses that still need work, in the order an operator should attack them. */
export const FLEET_MIGRATION_ACTIVE_STATUSES: ReadonlyArray<FleetMigrationEntryStatus> = [
  "stuck",
  "pending",
  "unenrol-issued",
  "awaiting-enrolment",
];

/** Statuses an unenrol handoff may be issued (or re-issued) from. */
export const FLEET_MIGRATION_ISSUABLE_STATUSES: ReadonlyArray<FleetMigrationEntryStatus> = [
  "pending",
  "unenrol-issued",
  "awaiting-enrolment",
  "stuck",
  "enrolled",
];

const SERIAL_LENGTH_PROBLEM = (value: string): boolean =>
  value.length === 0 || value.length > FLEET_MIGRATION_SERIAL_MAX_LENGTH;

/**
 * Canonical cohort serial. Hardware serials are case-insensitive and paste with
 * surrounding whitespace, so the cohort stores one spelling and matches with it.
 */
export const normalizeMigrationSerial = (value: string): string => value.trim().toUpperCase();

export type MigrationSerialProblem = {
  readonly serial: string;
  readonly problem: string;
};

/**
 * Validate and dedupe a pasted serial list. Duplicates are dropped rather than
 * failing the whole import: an operator copying a device list from another MDM
 * will hit them, and the first occurrence is the one they meant.
 */
export type MigrationSerialNormalization = {
  readonly serials: ReadonlyArray<string>;
  readonly duplicates: ReadonlyArray<string>;
  readonly invalid: ReadonlyArray<MigrationSerialProblem>;
};

export const normalizeMigrationSerials = (
  values: ReadonlyArray<string>,
): MigrationSerialNormalization => {
  const serials: string[] = [];
  const duplicates: string[] = [];
  const invalid: MigrationSerialProblem[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const serial = normalizeMigrationSerial(value ?? "");

    if (SERIAL_LENGTH_PROBLEM(serial)) {
      invalid.push({ serial, problem: "A serial is required and must be at most 64 characters" });
      continue;
    }

    if (!FLEET_MIGRATION_SERIAL_PATTERN.test(serial)) {
      invalid.push({
        serial,
        problem: "A serial may only contain letters, digits, dot, dash and underscore",
      });
      continue;
    }

    if (seen.has(serial)) {
      duplicates.push(serial);
      continue;
    }

    seen.add(serial);
    serials.push(serial);
  }

  return { serials, duplicates, invalid };
};

/** Clamp a requested batch to the documented bound. */
export const clampMigrationUnenrolBatch = (value: number | null | undefined): number => {
  if (value === null || value === undefined || !Number.isFinite(value))
    return FLEET_MIGRATION_UNENROL_BATCH_DEFAULT;

  return Math.min(Math.max(Math.trunc(value), 1), FLEET_MIGRATION_UNENROL_BATCH_MAX);
};

/** How long a device gets before a silent return becomes `stuck`. */
export const clampMigrationStuckDays = (value: number | null | undefined): number => {
  if (value === null || value === undefined || !Number.isFinite(value))
    return FLEET_MIGRATION_STUCK_DAYS_DEFAULT;

  return Math.min(
    Math.max(Math.trunc(value), FLEET_MIGRATION_STUCK_DAYS_MIN),
    FLEET_MIGRATION_STUCK_DAYS_MAX,
  );
};

const day = 24 * 60 * 60 * 1000;

/** The instant a silently-migrating device becomes stuck, if it has a deadline. */
export const migrationStuckAt = (input: {
  readonly status: FleetMigrationEntryStatus;
  readonly issuedAt: Date | null;
  readonly stuckAfterDays: number;
}): Date | null => {
  if (input.status !== "unenrol-issued" && input.status !== "awaiting-enrolment") return null;

  if (!input.issuedAt) return null;

  return new Date(input.issuedAt.getTime() + input.stuckAfterDays * day);
};

export const migrationIsStuck = (input: {
  readonly status: FleetMigrationEntryStatus;
  readonly issuedAt: Date | null;
  readonly stuckAfterDays: number;
  readonly now: Date;
}): boolean => {
  const deadline = migrationStuckAt(input);

  return deadline !== null && deadline.getTime() <= input.now.getTime();
};

/** What an operator can do to one entry, used by the UI to render actions. */
export const migrationEntryActions = (
  status: FleetMigrationEntryStatus,
): ReadonlyArray<"unenrol" | "mark-unenrolled" | "confirm"> => {
  const actions: Array<"unenrol" | "mark-unenrolled" | "confirm"> = [];

  if (status === "pending" || status === "stuck" || status === "enrolled") actions.push("unenrol");

  // A straggler can be re-issued: the operator selects it explicitly, which
  // is how the batch endpoint treats an already-issued entry.
  if (status === "unenrol-issued" || status === "awaiting-enrolment") actions.push("unenrol");

  if (status === "unenrol-issued") actions.push("mark-unenrolled");

  if (status === "enrolled") actions.push("confirm");

  return actions;
};

/**
 * A device the cohort is watching, as it exists in Mattrax right now. Absent
 * until the device record reappears (that is the "return" the cohort waits for).
 */
export type MigrationDeviceFact = {
  readonly id: string;
  readonly name: string;
  readonly serial: string | null;
  readonly status: string;
  /** When the current device record enrolled; null when the row has none. */
  readonly enrolledAt: Date | null;
} | null;

/** The unenrol run's result, when the handoff was delivered through Mattrax. */
export type MigrationExecutionFact = {
  readonly id: string;
  readonly status: string;
  readonly exitCode: number | null;
  readonly detail: string | null;
} | null;

export type MigrationEntryFacts = {
  readonly status: FleetMigrationEntryStatus;
  readonly platform: FleetMigrationPlatform;
  readonly serial: string;
  readonly deviceId: string | null;
  readonly unenrolIssuedAt: Date | null;
  readonly stuckAfterDays: number;
  readonly now: Date;
};

/** The persisted consequence of one observation. */
export type MigrationEntryObservation = {
  readonly status: FleetMigrationEntryStatus;
  readonly lastEvidence: string;
  readonly deviceId?: string | null;
  readonly awaitingEnrolmentAt?: Date;
  readonly enrolledAt?: Date;
  readonly stuckAt?: Date;
};

const describeExecution = (execution: NonNullable<MigrationExecutionFact>): string => {
  const exit = execution.exitCode === null ? "" : ` (exit ${execution.exitCode})`;
  const detail = execution.detail ? `: ${execution.detail}` : "";

  return `Unenrol script ${execution.status}${exit}${detail}`;
};

/**
 * Derive the next status from what the server can actually see.
 *
 * Order matters: a returning device always wins (the migration succeeded, even
 * if the handoff report was lost), then a delivered script result moves the
 * entry to "awaiting enrolment", then the deadline. Returning null means the
 * entry is unchanged.
 */
export const observeMigrationEntry = (
  facts: MigrationEntryFacts,
  device: MigrationDeviceFact,
  execution: MigrationExecutionFact,
): MigrationEntryObservation | null => {
  if (facts.status === "confirmed") return null;

  // A return needs a handoff that actually happened and a device that enrolled
  // after it. A device that was already enrolled when the unenrol was issued is
  // the operator's "only managed copy" decision, not a completed migration, so
  // it is left to the explicit confirmation path.
  const returned =
    device !== null &&
    device.status === "enrolled" &&
    facts.unenrolIssuedAt !== null &&
    (device.enrolledAt === null || device.enrolledAt.getTime() > facts.unenrolIssuedAt.getTime()) &&
    facts.status !== "enrolled";

  if (returned) {
    return {
      status: "enrolled",
      deviceId: device.id,
      enrolledAt: facts.now,
      lastEvidence: `Device "${device.name}" (${device.serial ?? facts.serial}) is enrolled in Mattrax.`,
    };
  }

  if (facts.status === "unenrol-issued" && execution) {
    if (execution.status === "succeeded")
      return {
        status: "awaiting-enrolment",
        awaitingEnrolmentAt: facts.now,
        lastEvidence: `${describeExecution(execution)}. The device left Mattrax's queue; waiting for it to enrol.`,
      };

    if (["failed", "expired", "cancelled"].includes(execution.status))
      return {
        status: "unenrol-issued",
        lastEvidence: describeExecution(execution),
      };
  }

  if (
    migrationIsStuck({
      status: facts.status,
      issuedAt: facts.unenrolIssuedAt,
      stuckAfterDays: facts.stuckAfterDays,
      now: facts.now,
    })
  )
    return {
      status: "stuck",
      stuckAt: facts.now,
      lastEvidence: `No return within ${facts.stuckAfterDays} day${facts.stuckAfterDays === 1 ? "" : "s"} of the unenrol being issued.`,
    };

  return null;
};

/** True when an observation would change a stored row (so a read is a no-op). */
export const migrationObservationChanges = (
  entry: {
    readonly status: FleetMigrationEntryStatus;
    readonly lastEvidence: string | null;
    readonly deviceId: string | null;
  },
  observation: MigrationEntryObservation | null,
): boolean => {
  if (!observation) return false;

  if (observation.status !== entry.status) return true;

  if (observation.lastEvidence !== (entry.lastEvidence ?? "")) return true;

  return observation.deviceId !== undefined && observation.deviceId !== entry.deviceId;
};

// --- Unenrol handoff -------------------------------------------------------

export type MigrationUnenrolDelivery = "script" | "manual";

export type MigrationUnenrolScript = {
  readonly language: "bash" | "pwsh";
  readonly runAs: "root" | "user";
  readonly timeoutSeconds: number;
  readonly body: string;
};

export type MigrationUnenrolRecipe = {
  readonly platform: FleetMigrationPlatform;
  /** `script` can be queued through Mattrax; `manual` is a documented step. */
  readonly delivery: MigrationUnenrolDelivery;
  readonly script: MigrationUnenrolScript | null;
  /** What the operator does in the incumbent MDM. */
  readonly instructions: string;
  /** What the device/user sees, for the ticket sent to the end user. */
  readonly deviceSteps: ReadonlyArray<string>;
};

/**
 * macOS is the only platform where a one-shot script can unattended-remove MDM
 * enrolment: `profiles -D` deletes every configuration profile, including the
 * incumbent's MDM profile. Windows needs the interactive "Disconnect" flow (or
 * Microsoft's `DeviceEnroller.exe /c /AutoUnenroll` for Intune), and Android
 * leaves the enterprise through the EMM console; both are manual steps rather
 * than invented script primitives.
 */
const APPLE_UNENROL_SCRIPT = `#!/bin/bash
# Mattrax migration: remove this Mac from its current MDM.
#
# Run once as root. "profiles -D" removes every configuration profile on the
# Mac, including the incumbent MDM's enrolment profile. The Mac is unmanaged
# from then until the Mattrax enrolment profile is installed.
set -u

if [ "$(id -u)" -ne 0 ]; then
  echo "mattrax-migration: this script must run as root" >&2
  exit 1
fi

echo "mattrax-migration: profiles before removal"
profiles -L 2>&1 | head -c 4000

profiles -D
status=$?

echo
echo "mattrax-migration: profiles -D exited with $status"
profiles -L 2>&1 | head -c 4000

exit "$status"
`;

export const migrationUnenrolRecipe = (
  platform: FleetMigrationPlatform,
): MigrationUnenrolRecipe => {
  switch (platform) {
    case "apple":
      return {
        platform,
        delivery: "script",
        script: {
          language: "bash",
          runAs: "root",
          timeoutSeconds: 600,
          body: APPLE_UNENROL_SCRIPT,
        },
        instructions:
          "Deploy the script once through the incumbent MDM (a one-time policy, platform script or custom script) or run it locally as root. Then enrol the Mac in Mattrax.",
        deviceSteps: [
          "Save any open work; the Mac may restart or sign the user out.",
          "When the incumbent profile is removed, open the Mattrax enrolment link.",
          "Download the enrolment profile and install it in System Settings → General → Device Management.",
        ],
      };
    case "win":
      return {
        platform,
        delivery: "manual",
        script: null,
        instructions:
          "Windows has no supported unattended way to leave a third-party MDM. On the device choose Settings → Accounts → Access work or school, select the incumbent tenant and choose Disconnect. Intune also accepts a one-time DeviceEnroller.exe /c /AutoUnenroll {EnrollmentId} run as SYSTEM. Then connect the device to Mattrax.",
        deviceSteps: [
          "Settings → Accounts → Access work or school.",
          "Select the incumbent organisation and choose Disconnect.",
          "Return to Settings → Accounts → Access work or school → Connect and enter the Mattrax enrolment link.",
        ],
      };
    case "android":
      return {
        platform,
        delivery: "manual",
        script: null,
        instructions:
          "Retire the device in the incumbent EMM console (Retire for a work profile, Delete device for a fully managed one). Android Management API has no arbitrary-script command, so Mattrax cannot hand this off as a script. Then provision the device into Mattrax through a QR code or zero-touch.",
        deviceSteps: [
          "The work profile and its data are removed when the incumbent retires the device.",
          "Factory reset a fully managed device, then scan the Mattrax provisioning QR code.",
        ],
      };
  }
};

/** Deployment hint for the incumbent named by the cohort. */
export const migrationUnenrolDeploymentHint = (source: FleetMigrationSource): string => {
  switch (source) {
    case "jamf":
      return "Jamf Pro → Settings → Scripts, then a one-time policy scoped to the cohort's devices.";
    case "intune":
      return "Intune → Devices → Scripts and remediations → Platform scripts, assigned to the cohort's device group.";
    case "kandji":
      return "Kandji → Library → Custom Scripts, then assign it to the Blueprint as a one-time run.";
    case "other":
      return "Use the incumbent's one-shot script or policy feature, scoped to the cohort's devices.";
  }
};

// --- Enrolment handoff -----------------------------------------------------

export const migrationEnrollmentUrl = (origin: string, organizationId: string): string =>
  `${origin.replace(/\/+$/, "")}/enroll/${encodeURIComponent(organizationId)}`;

/** The per-platform enrolment instructions included in the export. */
export type MigrationEnrolmentGuide = {
  readonly platform: FleetMigrationPlatform;
  readonly enrollmentUrl: string;
  readonly label: string;
  readonly steps: ReadonlyArray<string>;
  /** Where the profile or discovery document comes from, when there is one. */
  readonly profileUrl: string | null;
  readonly note: string;
};

export const migrationEnrolmentGuide = (input: {
  readonly platform: FleetMigrationPlatform;
  readonly origin: string;
  readonly organizationId: string;
}): MigrationEnrolmentGuide => {
  const enrollmentUrl = migrationEnrollmentUrl(input.origin, input.organizationId);

  switch (input.platform) {
    case "apple":
      return {
        platform: "apple",
        enrollmentUrl,
        label: "Apple enrolment URL",
        profileUrl: `${input.origin.replace(/\/+$/, "")}/api/v1/enrollment/${encodeURIComponent(input.organizationId)}/apple.mobileconfig`,
        steps: [
          `Open ${enrollmentUrl} in Safari on the Mac, iPhone or iPad.`,
          "Download the enrolment profile and install it in System Settings → General → Device Management.",
          "Pre-fill the incumbent MDM's re-enrolment URL field with the same link so the switch can be automated later.",
        ],
        note: "Installing the profile requires user approval unless the device is supervised and enrolled through ADE.",
      };
    case "win":
      return {
        platform: "win",
        enrollmentUrl,
        label: "Windows enrolment URL",
        profileUrl: null,
        steps: [
          `Open ${enrollmentUrl} on the device, or point Autopilot/Entra enrolment at the tenant discovery URL shown in Settings → Enrollment.`,
          "Settings → Accounts → Access work or school → Connect, then sign in.",
          "Pre-fill the incumbent MDM's re-enrolment URL field with the same link where it supports it.",
        ],
        note: "Windows needs the tenant's discovery URL from Settings → Enrollment; the link above starts the documented browser flow.",
      };
    case "android":
      return {
        platform: "android",
        enrollmentUrl,
        label: "Android enrolment URL",
        profileUrl: null,
        steps: [
          `Open ${enrollmentUrl} on the device after it leaves the incumbent EMM.`,
          "Fully managed devices use the Mattrax provisioning QR code; a work profile uses the enrolment link.",
          "Pre-fill the incumbent MDM's re-enrolment URL field with the same link where it supports it.",
        ],
        note: "Android enrolment needs Android Enterprise connected; see Settings → Enrollment for the QR code and token state.",
      };
  }
};

// --- API schemas -----------------------------------------------------------

export const FleetMigrationCounts = Schema.Struct({
  total: Schema.Number,
  pending: Schema.Number,
  unenrolIssued: Schema.Number,
  awaitingEnrolment: Schema.Number,
  enrolled: Schema.Number,
  confirmed: Schema.Number,
  stuck: Schema.Number,
});

export type FleetMigrationCounts = typeof FleetMigrationCounts.Type;

export const FleetMigrationSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  sourceMdm: FleetMigrationSource,
  platforms: Schema.Array(FleetMigrationPlatform),
  groupId: Schema.optional(NullableString),
  groupName: Schema.optional(NullableString),
  stuckAfterDays: Schema.Number,
  counts: FleetMigrationCounts,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type FleetMigrationSummary = typeof FleetMigrationSummary.Type;

export const FleetMigrationEntry = Schema.Struct({
  id: Schema.String,
  migrationId: MigrationId.schema,
  serial: Schema.String,
  platform: FleetMigrationPlatform,
  status: FleetMigrationEntryStatus,
  deviceId: Schema.optional(NullableString),
  deviceName: Schema.optional(NullableString),
  executionId: Schema.optional(NullableString),
  unenrolIssuedAt: Schema.optional(NullableString),
  awaitingEnrolmentAt: Schema.optional(NullableString),
  enrolledAt: Schema.optional(NullableString),
  confirmedAt: Schema.optional(NullableString),
  stuckAt: Schema.optional(NullableString),
  lastEvidence: Schema.optional(NullableString),
  actions: Schema.Array(Schema.Literals(["unenrol", "mark-unenrolled", "confirm"])),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type FleetMigrationEntry = typeof FleetMigrationEntry.Type;

export const FleetMigrationDetail = Schema.Struct({
  migration: FleetMigrationSummary,
  entries: Schema.Array(FleetMigrationEntry),
  enrollment: Schema.Struct({
    url: Schema.String,
    guides: Schema.Array(
      Schema.Struct({
        platform: FleetMigrationPlatform,
        enrollmentUrl: Schema.String,
        label: Schema.String,
        steps: Schema.Array(Schema.String),
        profileUrl: Schema.optional(NullableString),
        note: Schema.String,
      }),
    ),
    unenrol: Schema.Array(
      Schema.Struct({
        platform: FleetMigrationPlatform,
        delivery: Schema.Literals(["script", "manual"]),
        instructions: Schema.String,
        /** The one-shot script body, when the platform supports one. */
        script: Schema.optional(NullableString),
      }),
    ),
    deploymentHint: Schema.String,
  }),
});

export type FleetMigrationDetail = typeof FleetMigrationDetail.Type;

export const FleetMigrationListResponse = Schema.Struct({
  migrations: Schema.Array(FleetMigrationSummary),
});

export type FleetMigrationListResponse = typeof FleetMigrationListResponse.Type;

export const CreateFleetMigrationRequest = Schema.Struct({
  name: Schema.String,
  sourceMdm: FleetMigrationSource,
  platforms: Schema.Array(FleetMigrationPlatform),
  /** Seed from an existing device group's serials, when no explicit list is given. */
  groupId: Schema.optional(NullableString),
  /**
   * Explicit serials, for devices the incumbent manages and Mattrax cannot see.
   * A serial with no matching device takes the first target platform, because
   * only the device row (or the operator's export) knows otherwise.
   */
  serials: Schema.optional(Schema.Array(Schema.String)),
  stuckAfterDays: Schema.optional(Schema.Number),
});

export type CreateFleetMigrationRequest = typeof CreateFleetMigrationRequest.Type;

export const CreateFleetMigrationResponse = Schema.Struct({
  id: Schema.String,
  /** Serials added to the cohort. */
  added: Schema.Number,
  /** Serials dropped because the cohort already contained them. */
  duplicates: Schema.Array(Schema.String),
  /** Serials with an explanation instead of a cohort row. */
  skipped: Schema.Array(Schema.Struct({ serial: Schema.String, reason: Schema.String })),
});

export type CreateFleetMigrationResponse = typeof CreateFleetMigrationResponse.Type;

export const IssueFleetMigrationUnenrolRequest = Schema.Struct({
  /** Defaults to the whole cohort, newest-first within the batch bound. */
  entryIds: Schema.optional(Schema.Array(Schema.String)),
  limit: Schema.optional(Schema.Number),
  /**
   * Required when a targeted device is currently enrolled in Mattrax: removing
   * the incumbent profile also removes Mattrax's only managed copy.
   */
  confirmSoleCopy: Schema.optional(Schema.Boolean),
});

export type IssueFleetMigrationUnenrolRequest = typeof IssueFleetMigrationUnenrolRequest.Type;

export const FleetMigrationUnenrolResult = Schema.Struct({
  entryId: Schema.String,
  serial: Schema.String,
  platform: FleetMigrationPlatform,
  status: FleetMigrationEntryStatus,
  delivery: Schema.Literals(["script", "manual"]),
  executionId: Schema.optional(NullableString),
  instructions: Schema.String,
  skippedReason: Schema.optional(NullableString),
});

export type FleetMigrationUnenrolResult = typeof FleetMigrationUnenrolResult.Type;

export const IssueFleetMigrationUnenrolResponse = Schema.Struct({
  issued: Schema.Number,
  skipped: Schema.Number,
  results: Schema.Array(FleetMigrationUnenrolResult),
  /** Entries still waiting for a handoff after this batch. */
  remaining: Schema.Number,
  /** Devices this batch would unenrol while they are still Mattrax's only copy. */
  soleCopies: Schema.Array(Schema.String),
});

export type IssueFleetMigrationUnenrolResponse = typeof IssueFleetMigrationUnenrolResponse.Type;

export const FleetMigrationEntryActionResponse = Schema.Struct({
  status: FleetMigrationEntryStatus,
  lastEvidence: Schema.optional(NullableString),
});

export type FleetMigrationEntryActionResponse = typeof FleetMigrationEntryActionResponse.Type;

export const FleetMigrationExportQuery = Schema.Struct({
  format: Schema.optional(Schema.Literals(["csv", "json"])),
});

export type FleetMigrationExportQuery = typeof FleetMigrationExportQuery.Type;
