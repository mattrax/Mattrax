import type { AuditLogEntry } from "@mattrax/enterprise-domain/client";

/** Actor key stored on events written without a request context. */
export const SYSTEM_AUDIT_ACTOR = "system";

/** `device.command_failed` → `Device · command failed`. */
export const formatAuditAction = (action: string) =>
  action
    .split(".")
    .map((part) => part.replaceAll("_", " "))
    .join(" · ")
    .replace(/^\w/, (letter) => letter.toUpperCase())
    // `MDM` is an acronym, not a word that should be title-cased.
    .replace(/^Mdm\b/, "MDM");

/**
 * Human actor name. The system sentinel is never shown as an address: it is
 * the deployment acting on a device, not a person.
 */
export const auditActorLabel = (
  entry: Pick<AuditLogEntry, "actorType" | "actorEmail">,
): string => {
  if (entry.actorType === "system" || !entry.actorEmail || entry.actorEmail === SYSTEM_AUDIT_ACTOR)
    return "System";

  return entry.actorEmail;
};

const ACTOR_KIND_LABELS: Record<AuditLogEntry["actorType"], string> = {
  account: "Account",
  "api-token": "API token",
  system: "Device / system",
};

/** Short description of what kind of principal produced the row. */
export const auditActorKind = (entry: Pick<AuditLogEntry, "actorType">): string =>
  ACTOR_KIND_LABELS[entry.actorType];

const PROTOCOL_LABELS = {
  apple: "Apple",
  win: "Windows",
  android: "Android",
} satisfies Record<string, string>;

/** Display name for the MDM channel, or undefined for account/system rows. */
export const auditProtocolLabel = (protocol: string | null | undefined): string | undefined => {
  if (protocol === "apple" || protocol === "win" || protocol === "android")
    return PROTOCOL_LABELS[protocol];

  return undefined;
};
