import { Effect, Option, Schema } from "effect";
import { parsePlist, serializePlist } from "@mattrax/plist";
import type { PlistValue } from "@mattrax/plist";

/**
 * macOS delivery for restricted software.
 *
 * Each rule becomes one configuration profile with a
 * `com.mattrax.restricted-software` payload. `mattraxd` reads installed
 * profiles, enforces the rule on its timer and posts a result to the signed
 * agent endpoint. Profiles are keyed by rule id, so editing a rule replaces
 * the profile instead of accumulating copies.
 */

export const MATTRAX_RESTRICTED_SOFTWARE_PAYLOAD_TYPE = "com.mattrax.restricted-software";

export const RESTRICTED_SOFTWARE_PROFILE_IDENTIFIER_PREFIX = "com.mattrax.restricted-software.";

export const restrictedSoftwareProfileIdentifier = (ruleId: string) =>
  `${RESTRICTED_SOFTWARE_PROFILE_IDENTIFIER_PREFIX}${ruleId}`;

/**
 * The outer `.mobileconfig` identifier the device reports. This, not the
 * payload identifier, is the key in the installed-profile map.
 */
export const restrictedSoftwareProfileDocumentIdentifier = (ruleId: string) =>
  `${restrictedSoftwareProfileIdentifier(ruleId)}.profile`;

export const isRestrictedSoftwareProfileIdentifier = (identifier: string): boolean =>
  identifier.startsWith(RESTRICTED_SOFTWARE_PROFILE_IDENTIFIER_PREFIX);

export type RestrictedSoftwarePayloadInput = {
  readonly ruleId: string;
  readonly name: string;
  readonly matchType: "bundle-id" | "process-name";
  readonly matchValue: string;
  readonly action: "kill-process" | "delete-app";
  readonly message?: string | null;
  /** How often the agent re-checks the rule. */
  readonly intervalSeconds: number;
  /** Where the agent posts results, and the signed identity it presents. */
  readonly serverUrl: string;
  readonly deviceToken: string;
};

const encoder = new TextEncoder();

const stableUuid = async (value: string): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))).slice(
    0,
    16,
  );

  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** One `com.mattrax.restricted-software` payload dictionary. */
export const restrictedSoftwarePayload = async (
  input: RestrictedSoftwarePayloadInput,
): Promise<Record<string, PlistValue>> => ({
  PayloadType: MATTRAX_RESTRICTED_SOFTWARE_PAYLOAD_TYPE,
  PayloadIdentifier: restrictedSoftwareProfileIdentifier(input.ruleId),
  PayloadUUID: await stableUuid(`mattrax:restricted-software:${input.ruleId}`),
  PayloadDisplayName: input.name,
  PayloadDescription: input.message ?? `Mattrax restricted software: ${input.name}`,
  PayloadVersion: 1,
  RestrictedSoftwareID: input.ruleId,
  MatchType: input.matchType,
  MatchValue: input.matchValue,
  Action: input.action,
  Message: input.message ?? "",
  IntervalSeconds: Math.max(60, Math.trunc(input.intervalSeconds)),
  ServerURL: input.serverUrl,
  DeviceToken: input.deviceToken,
});

/** Encode the `.mobileconfig` installed on the Mac. */
export const buildRestrictedSoftwareProfile = async (
  input: RestrictedSoftwarePayloadInput,
): Promise<Uint8Array> => {
  const documentIdentifier = restrictedSoftwareProfileDocumentIdentifier(input.ruleId);

  const profile: PlistValue = {
    PayloadContent: [await restrictedSoftwarePayload(input)],
    PayloadDisplayName: `Mattrax restricted software: ${input.name}`.slice(0, 120),
    PayloadIdentifier: documentIdentifier,
    PayloadOrganization: "Mattrax",
    PayloadType: "Configuration",
    PayloadUUID: await stableUuid(`mattrax:restricted-software-profile:${input.ruleId}`),
    PayloadVersion: 1,
  };

  const plist = await Effect.runPromise(serializePlist(profile));

  return encoder.encode(plist);
};

const Payload = Schema.Struct({
  PayloadType: Schema.optional(Schema.String),
  PayloadDisplayName: Schema.optional(Schema.String),
  RestrictedSoftwareID: Schema.optional(Schema.String),
  MatchType: Schema.optional(Schema.String),
  MatchValue: Schema.optional(Schema.String),
  Action: Schema.optional(Schema.String),
  Message: Schema.optional(Schema.String),
  IntervalSeconds: Schema.optional(Schema.Number),
  ServerURL: Schema.optional(Schema.String),
  DeviceToken: Schema.optional(Schema.String),
});

const Profile = Schema.Struct({
  PayloadContent: Schema.optional(Schema.Array(Payload)),
});

export type InstalledRestrictedSoftwareProfile = {
  readonly ruleId: string;
  readonly name: string;
  readonly matchType: "bundle-id" | "process-name";
  readonly matchValue: string;
  readonly action: "kill-process" | "delete-app";
  readonly message: string | null;
  readonly intervalSeconds: number;
  readonly serverUrl: string;
  readonly deviceToken: string;
};

/**
 * Read restricted-software payloads from an installed profile. The agent only
 * enforces the two actions it implements; an unknown action is ignored rather
 * than guessed.
 */
export const parseRestrictedSoftwareProfile = async (
  bytes: Uint8Array,
): Promise<ReadonlyArray<InstalledRestrictedSoftwareProfile>> => {
  const parsed = await Effect.runPromise(
    Effect.match(parsePlist(new TextDecoder().decode(bytes)), {
      onFailure: () => null,
      onSuccess: (value) => value,
    }),
  );

  const profile = Option.getOrNull(Schema.decodeUnknownOption(Profile)(parsed));

  if (!profile?.PayloadContent) return [];

  return profile.PayloadContent.flatMap((payload) => {
    if (payload.PayloadType !== MATTRAX_RESTRICTED_SOFTWARE_PAYLOAD_TYPE) return [];

    if (!payload.RestrictedSoftwareID || !payload.MatchValue || !payload.ServerURL) return [];

    if (payload.MatchType !== "bundle-id" && payload.MatchType !== "process-name") return [];

    if (payload.Action !== "kill-process" && payload.Action !== "delete-app") return [];

    return [
      {
        ruleId: payload.RestrictedSoftwareID,
        name: payload.PayloadDisplayName ?? payload.RestrictedSoftwareID,
        matchType: payload.MatchType,
        matchValue: payload.MatchValue,
        action: payload.Action,
        message: payload.Message?.trim() ? payload.Message : null,
        intervalSeconds: Math.max(60, Math.trunc(payload.IntervalSeconds ?? 300)),
        serverUrl: payload.ServerURL,
        deviceToken: payload.DeviceToken ?? "",
      },
    ];
  });
};

export type DesiredRestrictedSoftwareProfile = {
  readonly ruleId: string;
  readonly identifier: string;
  /** SHA-256 of the encoded profile bytes. */
  readonly digest: string;
  readonly profile: Uint8Array;
};

export type RestrictedSoftwareProfileChanges = {
  readonly install: ReadonlyArray<DesiredRestrictedSoftwareProfile>;
  readonly remove: ReadonlyArray<string>;
};

/** Compare desired profiles with the identifiers the device already holds. */
export const planRestrictedSoftwareProfileChanges = (
  desired: ReadonlyArray<DesiredRestrictedSoftwareProfile>,
  installed: ReadonlyMap<string, string>,
): RestrictedSoftwareProfileChanges => ({
  install: desired.filter((profile) => installed.get(profile.identifier) !== profile.digest),
  remove: [...installed.keys()]
    .filter(
      (identifier) =>
        isRestrictedSoftwareProfileIdentifier(identifier) &&
        !desired.some((profile) => profile.identifier === identifier),
    )
    .sort(),
});
