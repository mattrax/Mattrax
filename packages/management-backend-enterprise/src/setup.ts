/**
 * ADE setup gating.
 *
 * A device whose ADE cloud configuration sets `await_device_configured` stays
 * in Setup Assistant until the server sends `DeviceConfigured`. The server must
 * not release it before the setup payload has actually applied: the managed
 * local admin exists and the initial declarations (or legacy profiles) are
 * valid. These rules are pure so the ordering is testable without a database.
 */
import { commandStatusIsActive } from "./commands.js";
import { normalizeDeviceCommandStatus } from "@mattrax/enterprise-domain";

export type SetupDeclaration = {
  readonly declarationType?: string;
  readonly valid?: string | null;
  readonly active?: boolean;
};

export type SetupCommand = {
  readonly requestType: string;
  readonly status?: string | null;
};

export type SetupReleaseInput = {
  /** The device reported `AwaitingConfiguration` in TokenUpdate. */
  readonly awaitingConfiguration: boolean;
  /** The server has already released the device. */
  readonly configured: boolean;
  /** Apple's policy delivery path, once the first check-in has decided it. */
  readonly deliveryMode?: "ddm" | "legacy" | null;
  /**
   * Whether any non-application policy payload is assigned to the device. With
   * no expected payload there is no declaration report or profile install to
   * wait for, so the setup payload is already complete.
   */
  readonly expectedSetupPayload: boolean;
  /** macOS is the only platform with `AccountConfiguration`. */
  readonly isMac: boolean;
  readonly declarations: ReadonlyArray<SetupDeclaration>;
  readonly commands: ReadonlyArray<SetupCommand>;
};

export type SetupReleaseBlocker =
  | "local-admin-pending"
  | "local-admin-failed"
  | "declarations-missing"
  | "declarations-invalid"
  | "profiles-pending"
  | "profiles-failed";

const DECLARATION_TYPES = new Set(["activations", "configurations", "management"]);

/** True when a command is still able to run (and therefore still pending). */
const isActive = (status: string | null | undefined) =>
  commandStatusIsActive(normalizeDeviceCommandStatus(status));

/**
 * Why the device must stay in Setup Assistant. An empty list means the setup
 * payload is ready and `DeviceConfigured` can be queued.
 *
 * Declarations are valid only when every delivered declaration reports
 * `Valid`, with at least one configuration/activation/management declaration
 * present. An empty DDM report is not proof that policy applied. On the legacy
 * path the same proof comes from the `InstallProfile` commands.
 */
export const setupReleaseBlockers = (
  input: SetupReleaseInput,
): ReadonlyArray<SetupReleaseBlocker> => {
  if (!input.awaitingConfiguration || input.configured) return [];
  const blockers: SetupReleaseBlocker[] = [];

  if (input.isMac) {
    const adminCommands = input.commands.filter(
      (command) => command.requestType === "AccountConfiguration",
    );

    if (
      adminCommands.some(
        (command) =>
          normalizeDeviceCommandStatus(command.status) === "failed" ||
          normalizeDeviceCommandStatus(command.status) === "expired",
      )
    )
      blockers.push("local-admin-failed");
    else if (adminCommands.some((command) => isActive(command.status)))
      blockers.push("local-admin-pending");
    else if (adminCommands.length === 0)
      // The command is queued in the same transaction as the TokenUpdate; a
      // report that arrives before it is visible must not release the device.
      blockers.push("local-admin-pending");
  }

  if (input.deliveryMode === "legacy") {
    if (input.expectedSetupPayload) {
      const profiles = input.commands.filter((command) => command.requestType === "InstallProfile");

      if (
        profiles.some(
          (command) =>
            normalizeDeviceCommandStatus(command.status) === "failed" ||
            normalizeDeviceCommandStatus(command.status) === "expired",
        )
      )
        blockers.push("profiles-failed");
      else if (profiles.some((command) => isActive(command.status)))
        blockers.push("profiles-pending");
      else if (profiles.length === 0) blockers.push("profiles-pending");
    }
  } else if (input.expectedSetupPayload) {
    const declarations = input.declarations.filter((declaration) =>
      DECLARATION_TYPES.has(declaration.declarationType ?? ""),
    );

    if (declarations.length === 0) blockers.push("declarations-missing");
    else if (
      declarations.some(
        (declaration) =>
          (declaration.valid ?? "").trim() !== "valid" || declaration.active === false,
      )
    )
      blockers.push("declarations-invalid");
  }

  return blockers;
};

export const setupIsReady = (input: SetupReleaseInput): boolean =>
  input.awaitingConfiguration && !input.configured && setupReleaseBlockers(input).length === 0;
