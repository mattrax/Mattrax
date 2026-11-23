import { readFile, writeFile } from "node:fs/promises";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import type { DeviceSearchRow } from "@mattrax/enterprise-domain/client";
import { decodeMattraxArchive } from "../handover.ts";
import { formatJson, formatKeyValues, formatTable, line } from "../output.ts";
import { CliFailure } from "../settings.ts";
import { commandContext, requireConfirmation, resolveGroupId, resolveTenantId } from "./shared.ts";

const DEVICE_ACTIONS = [
  "sync",
  "lock",
  "wipe",
  "restart",
  "shutdown",
  "clear-passcode",
  "install-app",
  "collect-security-info",
  "refresh-applications",
  "collect-activation-lock-code",
  "rotate-filevault-key",
  "set-recovery-lock",
  "verify-recovery-lock",
  "start-lost-mode",
  "stop-lost-mode",
  "reset-password",
  "clear-app-data",
  "request-device-info",
  "relinquish-ownership",
] as const;

const DESTRUCTIVE_ACTIONS = new Set<string>([
  "lock",
  "wipe",
  "shutdown",
  "clear-passcode",
  "set-recovery-lock",
  "rotate-filevault-key",
  "start-lost-mode",
  "reset-password",
  "clear-app-data",
  "relinquish-ownership",
]);

const timestamp = (value: string): string => value.replace("T", " ").slice(0, 16);

const deviceRow = (device: DeviceSearchRow): ReadonlyArray<string> => [
  device.name,
  device.proto,
  device.status,
  device.health.level,
  device.serial ?? "-",
  timestamp(device.lastSeenAt),
  device.id,
];

const list = Command.make(
  "list",
  {
    q: Flag.String("q").pipe(
      Flag.withDescription("Search name, serial, model, DM identifier or asset tag"),
      Flag.optional,
    ),
    status: Flag.Literals("status", ["enrolling", "enrolled", "unenrolling", "unenrolled"]).pipe(
      Flag.withDescription("Only devices in this lifecycle state"),
      Flag.optional,
    ),
    proto: Flag.Literals("proto", ["apple", "win", "android"]).pipe(
      Flag.withDescription("Only devices on this platform"),
      Flag.optional,
    ),
    group: Flag.String("group").pipe(
      Flag.withDescription("Only members of this group (id or exact name)"),
      Flag.optional,
    ),
    health: Flag.Literals("health", [
      "healthy",
      "attention",
      "missing",
      "critical",
      "unknown",
      "stale",
    ]).pipe(Flag.withDescription("Only devices with this derived health level"), Flag.optional),
    limit: Flag.Int("limit").pipe(
      Flag.withDescription("Page size (the API caps it at 200)"),
      Flag.withDefault(50),
    ),
    offset: Flag.Int("offset").pipe(Flag.withDescription("Rows to skip"), Flag.withDefault(0)),
  },
  Effect.fn(function* (config) {
    const { flags, settings, api } = yield* commandContext();
    const tenantId = yield* resolveTenantId(api, settings);
    const group = Option.getOrUndefined(config.group);
    const groupId = group ? yield* resolveGroupId(api, tenantId, group) : undefined;

    const response = yield* api.searchDevices(tenantId, {
      q: Option.getOrUndefined(config.q),
      status: Option.getOrUndefined(config.status),
      proto: Option.getOrUndefined(config.proto),
      health: Option.getOrUndefined(config.health),
      groupId,
      limit: config.limit,
      offset: config.offset,
    });

    if (flags.json) {
      yield* line(
        formatJson({
          devices: response.devices,
          total: response.total,
          limit: config.limit,
          offset: config.offset,
        }),
      );

      return;
    }

    if (response.devices.length === 0) {
      yield* line("No devices matched.");

      return;
    }

    yield* line(
      formatTable(
        ["NAME", "PROTO", "STATUS", "HEALTH", "SERIAL", "LAST SEEN", "ID"],
        response.devices.map(deviceRow),
      ),
    );
    yield* line("");
    yield* line(
      `Showing ${response.devices.length} of ${response.total} devices (offset ${config.offset}).`,
    );
  }),
).pipe(Command.withDescription("List or search managed devices"));

const get = Command.make(
  "get",
  { id: Argument.String("id").pipe(Argument.withDescription("Device id")) },
  Effect.fn(function* (config) {
    const { flags, settings, api } = yield* commandContext();
    const tenantId = yield* resolveTenantId(api, settings);
    const device = yield* api.getDevice(tenantId, config.id);
    const health = yield* api.getDeviceHealth(tenantId, config.id);

    if (flags.json) {
      yield* line(formatJson({ device, health }));

      return;
    }

    yield* line(
      formatKeyValues([
        { key: "ID", value: device.id },
        { key: "Name", value: device.name },
        { key: "Platform", value: device.proto },
        { key: "Status", value: device.status },
        { key: "Serial", value: device.serial },
        { key: "Model", value: device.model },
        { key: "OS", value: [device.osEdition, device.osVersion].filter(Boolean).join(" ") },
        { key: "Enrolled", value: timestamp(device.enrolledAt) },
        { key: "Last seen", value: timestamp(device.lastSeenAt) },
        { key: "Health", value: health.health.level },
        { key: "Asset tag", value: device.assetTag },
      ]),
    );

    if (health.health.reasons.length > 0) {
      yield* line("");
      yield* line("Health reasons:");

      for (const reason of health.health.reasons)
        yield* line(`  ${reason.severity.padEnd(8)} ${reason.label} (${reason.code})`);
    }

    if (device.groups && device.groups.length > 0) {
      yield* line("");
      yield* line("Groups:");

      for (const group of device.groups)
        yield* line(`  ${group.id}  ${group.name}${group.source ? ` (${group.source})` : ""}`);
    }
  }),
).pipe(Command.withDescription("Show one device and its health"));

const action = Command.make(
  "action",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Device id")),
    action: Argument.Literals("action", DEVICE_ACTIONS).pipe(
      Argument.withDescription("Remote action to queue"),
    ),
    manifestUrl: Flag.String("manifest-url").pipe(
      Flag.withDescription("Manifest URL for install-app"),
      Flag.optional,
    ),
    iTunesStoreId: Flag.Int("itunes-store-id").pipe(
      Flag.withDescription("Apple App Store id for install-app"),
      Flag.optional,
    ),
    recoveryLockPassword: Flag.String("recovery-lock-password").pipe(
      Flag.withDescription("Recovery Lock password for set-recovery-lock"),
      Flag.optional,
    ),
  },
  Effect.fn(function* (config) {
    const { flags, settings, api } = yield* commandContext();
    const tenantId = yield* resolveTenantId(api, settings);

    if (DESTRUCTIVE_ACTIONS.has(config.action))
      yield* requireConfirmation(flags, config.action, `device ${config.id}`);

    const manifestUrl = Option.getOrUndefined(config.manifestUrl);
    const iTunesStoreId = Option.getOrUndefined(config.iTunesStoreId);
    const recoveryLockPassword = Option.getOrUndefined(config.recoveryLockPassword);

    const response = yield* api.deviceAction(tenantId, config.id, {
      action: config.action,
      manifestUrl,
      iTunesStoreId,
      recoveryLockPassword,
    });

    if (flags.json) {
      yield* line(formatJson(response));

      return;
    }

    yield* line(`Queued ${config.action} for ${config.id}.`);

    if (response.commandId) yield* line(`Command  ${response.commandId}`);

    if (response.deduplicated) yield* line("An identical command was already in flight.");

    if (response.pin) yield* line(`Unlock PIN  ${response.pin}`);

    if (response.activationLockWarning) yield* line(`Warning  ${response.activationLockWarning}`);
  }),
).pipe(Command.withDescription("Queue a remote action for a device"));

const unenroll = Command.make(
  "unenroll",
  { id: Argument.String("id").pipe(Argument.withDescription("Device id")) },
  Effect.fn(function* (config) {
    const { flags, settings, api } = yield* commandContext();
    const tenantId = yield* resolveTenantId(api, settings);

    yield* requireConfirmation(flags, "Unenroll", `device ${config.id}`);
    yield* api.deviceUnenroll(tenantId, config.id);

    if (flags.json) {
      yield* line(formatJson({ status: "ok", deviceId: config.id }));

      return;
    }

    yield* line(`Unenrolled ${config.id}.`);
  }),
).pipe(Command.withDescription("Remove a device from management (requires --yes)"));

const handoverDecrypt = Command.make(
  "decrypt",
  {
    file: Argument.String("file").pipe(
      Argument.withDescription("Handover JSON envelope, or a Mattrax cutover archive"),
    ),
    passphrase: Flag.String("passphrase").pipe(
      Flag.withDescription(
        "Archive passphrase. Prefer --passphrase-file or MATTRAX_HANDOVER_PASSPHRASE so it does not enter shell history",
      ),
      Flag.optional,
    ),
    passphraseFile: Flag.String("passphrase-file").pipe(
      Flag.withDescription("Read the archive passphrase from this file (first line)"),
      Flag.optional,
    ),
    output: Flag.String("output").pipe(
      Flag.withAlias("o"),
      Flag.withDescription("Write the decrypted JSON here with mode 0600 instead of stdout"),
      Flag.optional,
    ),
  },
  Effect.fn(function* (config) {
    const passphraseFile = Option.getOrUndefined(config.passphraseFile);
    const passphrase = passphraseFile
      ? yield* Effect.tryPromise({
          try: async () => (await readFile(passphraseFile, "utf8")).split(/\r?\n/)[0] ?? "",
          catch: () =>
            new CliFailure({
              message: "The passphrase file could not be read.",
              hint: "Check --passphrase-file and try again.",
            }),
        })
      : (Option.getOrUndefined(config.passphrase) ?? process.env.MATTRAX_HANDOVER_PASSPHRASE);

    if (!passphrase)
      return yield* Effect.fail(
        new CliFailure({
          message: "A passphrase is required to open this archive.",
          hint: "Use --passphrase-file, MATTRAX_HANDOVER_PASSPHRASE, or --passphrase. Files created by Mattrax cannot be opened without it.",
        }),
      );

    const text = yield* Effect.tryPromise({
      try: () => readFile(config.file, "utf8"),
      catch: () =>
        new CliFailure({
          message: `Could not read "${config.file}".`,
          hint: "Pass the downloaded JSON envelope.",
        }),
    });

    const decoded = yield* Effect.tryPromise({
      try: () => decodeMattraxArchive(text, passphrase),
      catch: (cause) =>
        new CliFailure({
          message:
            cause instanceof Error
              ? cause.message
              : "The archive could not be decrypted with that passphrase.",
          hint: "The passphrase, or the file, did not match.",
        }),
    });

    const body = formatJson(decoded.kind === "handover" ? decoded.document : decoded.payload);
    const output = Option.getOrUndefined(config.output);

    if (output) {
      yield* Effect.tryPromise({
        try: () => writeFile(output, body + "\n", { encoding: "utf8", mode: 0o600 }),
        catch: () =>
          new CliFailure({
            message: `Could not write "${output}".`,
            hint: "Choose a writable path outside shared directories.",
          }),
      });
      yield* line(`Wrote decrypted ${decoded.kind} archive to ${output} (mode 0600).`);

      return;
    }

    yield* line(body);
  }),
).pipe(Command.withDescription("Decrypt a handover or cutover archive without uploading it"));

const handover = Command.make("handover").pipe(
  Command.withDescription("Work with sealed device handover archives"),
  Command.withSubcommands([handoverDecrypt]),
);

export const devicesCommand = Command.make("devices").pipe(
  Command.withDescription("Inspect and act on managed devices"),
  Command.withSubcommands([list, get, action, unenroll, handover]),
);
