import type { DeviceActivityEntry, DeviceCommandStatus } from "@mattrax/enterprise-domain/client";

export type CommandStatusTone = "success" | "warning" | "danger" | "brand" | "muted";

/**
 * Colour for a command lifecycle badge. The label itself comes from the API
 * (`DeviceCommandInfo.statusLabel`), so the dashboard never re-implements the
 * wording of a status.
 */
const STATUS_TONES: Record<DeviceCommandStatus, CommandStatusTone> = {
  queued: "muted",
  sent: "brand",
  deferred: "warning",
  succeeded: "success",
  failed: "danger",
  expired: "warning",
  superseded: "muted",
  cancelled: "muted",
  unknown: "muted",
};

export const commandStatusTone = (status: DeviceCommandStatus): CommandStatusTone =>
  STATUS_TONES[status] ?? "muted";

/** Whether the device may still run the command, so its deadline matters. */
export const isActiveCommandStatus = (status: DeviceCommandStatus) =>
  status === "queued" || status === "sent" || status === "deferred";

/**
 * Flatten activity pages into one feed. Each page continues from an opaque
 * keyset cursor, so an event that arrives while paging is not repeated; ids are
 * unique across sources and the first occurrence wins.
 */
export function mergeActivityPages(
  pages: ReadonlyArray<{ readonly events: ReadonlyArray<DeviceActivityEntry> }> | undefined,
): DeviceActivityEntry[] {
  const seen = new Map<string, DeviceActivityEntry>();

  for (const page of pages ?? [])
    for (const entry of page.events) if (!seen.has(entry.id)) seen.set(entry.id, entry);

  return [...seen.values()];
}
