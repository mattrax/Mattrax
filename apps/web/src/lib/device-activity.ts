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
 * Flatten activity pages into one feed. Pages are newest-first windows over a
 * live merge, so a new event can shift an older page and repeat a row; ids are
 * unique across sources, so the first occurrence wins and order is preserved.
 */
export function mergeActivityPages(
  pages: ReadonlyArray<{ readonly events: ReadonlyArray<DeviceActivityEntry> }> | undefined,
): DeviceActivityEntry[] {
  const seen = new Map<string, DeviceActivityEntry>();

  for (const page of pages ?? [])
    for (const entry of page.events) if (!seen.has(entry.id)) seen.set(entry.id, entry);

  return [...seen.values()];
}
