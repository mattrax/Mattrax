import { Option, Schema } from "effect";
import { openSecret, sealSecret } from "@mattrax/crypto";
import { applyEscrowCertificate, buildLegacyProfile, inspectMobileconfig } from "./policy.ts";
import type {
  PolicyCertificateMaterial,
  PolicyConfigurationRow,
  SkippedConfiguration,
} from "@mattrax/mdm-core";

/**
 * Legacy (pre-declarative) policy delivery.
 *
 * A device that cannot apply declarations still has to receive the policy. The
 * legacy equivalent of a declaration is a `.mobileconfig` installed with the
 * classic `InstallProfile` command; a removed profile is uninstalled with
 * `RemoveProfile`. Only kinds with a real legacy equivalent are compiled here,
 * and everything else is reported instead of being silently dropped.
 */

export type LegacyProfile = {
  readonly identifier: string;
  readonly policyId: string;
  readonly kind: string;
  readonly content: Uint8Array;
};

export type LegacyProfileBuild = {
  readonly profiles: ReadonlyArray<LegacyProfile>;
  readonly unsupported: ReadonlyArray<SkippedConfiguration>;
};

/**
 * Compile the policy's legacy-deliverable configurations into profiles.
 *
 * `escrowCertificatePem` is the tenant FileVault escrow certificate: a profile
 * that escrows recovery keys is rewritten to use it so the returned CMS payload
 * can actually be unwrapped.
 */
export const buildLegacyProfiles = async (
  configurations: ReadonlyArray<PolicyConfigurationRow>,
  options: {
    readonly escrowCertificatePem?: string | null;
    /** PFX material for identity profiles and mail S/MIME identities. */
    readonly materialFor?: (kind: string) => PolicyCertificateMaterial | null | undefined;
    /** Apple family; S/MIME mail keys are iOS-only. */
    readonly osFamily?: string | null;
  } = {},
): Promise<LegacyProfileBuild> => {
  const profiles: LegacyProfile[] = [];
  const unsupported: SkippedConfiguration[] = [];

  for (const configuration of configurations) {
    const built = await buildLegacyProfile(configuration, {
      material: options.materialFor?.(configuration.kind) ?? null,
      materialFor: options.materialFor,
      osFamily: options.osFamily,
    });

    if (!built) {
      unsupported.push({
        policyId: configuration.policyId,
        kind: configuration.kind,
        reason:
          "the configuration has no legacy profile equivalent; it needs a device that supports declarative management",
      });
      continue;
    }

    let content = built.content;

    if (options.escrowCertificatePem) {
      const rewritten = await applyEscrowCertificate(content, options.escrowCertificatePem);

      if ("error" in rewritten) {
        unsupported.push({
          policyId: configuration.policyId,
          kind: configuration.kind,
          reason: rewritten.error,
        });
        continue;
      }

      content = rewritten.content;
    }

    const inspection = await inspectMobileconfig(content);
    const identifier = inspection?.identifier;

    if (!identifier) {
      unsupported.push({
        policyId: configuration.policyId,
        kind: configuration.kind,
        reason: "the compiled profile has no PayloadIdentifier",
      });
      continue;
    }

    profiles.push({
      identifier,
      policyId: configuration.policyId,
      kind: configuration.kind,
      content,
    });
  }

  return { profiles, unsupported };
};

export type LegacyProfileChanges = {
  /** Profiles to install, or re-install because their content changed. */
  readonly install: ReadonlyArray<LegacyProfile>;
  /** Payload identifiers to remove. */
  readonly remove: ReadonlyArray<string>;
};

/** The command payloads this module reads back from device history. */
const InstallProfilePayload = Schema.Struct({ Payload: Schema.String });

const RemoveProfilePayload = Schema.Struct({ Identifier: Schema.String });

/** SHA-256 of the profile bytes, used to notice a policy edit. */
export const profileDigest = async (content: Uint8Array): Promise<string> => {
  // SAFETY: WebCrypto accepts a Uint8Array view as a BufferSource; the DOM lib
  // models the backing buffer separately.
  const digest = await crypto.subtle.digest("SHA-256", content as BufferSource);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

/**
 * Diff the profiles the policy wants against the ones the device already
 * installed. A profile whose content changed is re-installed; a profile no
 * longer in the policy is removed. Ordering is stable so a no-op check-in
 * queues nothing.
 */
export const planLegacyProfileChanges = async (
  profiles: ReadonlyArray<LegacyProfile>,
  installed: ReadonlyMap<string, string>,
): Promise<LegacyProfileChanges> => {
  const install: LegacyProfile[] = [];

  for (const profile of profiles) {
    const digest = await profileDigest(profile.content);

    if (installed.get(profile.identifier) !== digest) install.push(profile);
  }

  return {
    install,
    remove: [...installed.keys()]
      .filter((identifier) => !profiles.some((profile) => profile.identifier === identifier))
      .sort(),
  };
};

/** Base64 payload for an `InstallProfile` command. */
export const installProfilePayload = (profile: LegacyProfile) => {
  let binary = "";

  for (const byte of profile.content) binary += String.fromCharCode(byte);

  return { Payload: btoa(binary) };
};

/** Key that marks a command payload whose JSON body is sealed at rest. */
export const SEALED_COMMAND_PAYLOAD_KEY = "sealedPayload";

/**
 * Seal a command payload before it is stored in `device_command`.
 *
 * A legacy Apple identity profile embeds a private key and password. Storing
 * the base64 `.mobileconfig` as the command payload would put both in plaintext
 * in MySQL and every logical backup, defeating the sealed material row.
 */
export const sealCommandPayload = async (
  authSecret: string,
  payload: Schema.Json,
): Promise<Schema.JsonObject> => ({
  [SEALED_COMMAND_PAYLOAD_KEY]: await sealSecret(authSecret, JSON.stringify(payload)),
});

/** Open a sealed command payload, or return the original when it is plain. */
export const openCommandPayload = async (
  authSecret: string,
  payload: Schema.Json | null | undefined,
): Promise<Schema.Json> => {
  if (!Schema.is(Schema.JsonObject)(payload)) return payload ?? {};

  const sealed = payload[SEALED_COMMAND_PAYLOAD_KEY];

  if (!Schema.is(Schema.String)(sealed)) return payload;

  return JSON.parse(await openSecret(authSecret, sealed)) as Schema.Json;
};

/** Seal the legacy policy profile payload, which may contain a PKCS#12. */
export const sealLegacyInstallProfilePayload = async (
  authSecret: string,
  profile: LegacyProfile,
): Promise<Schema.JsonObject> => sealCommandPayload(authSecret, installProfilePayload(profile));

/** One successful profile command, newest first from the caller. */
export type InstalledProfileCommand = {
  readonly requestType: string;
  readonly payload: Schema.Json | null;
};

/**
 * Profile identifier → content digest from the device's own command history.
 *
 * Commands store their payload, so this survives a server restart without
 * another table. The caller supplies commands newest-first; this replays them
 * oldest-first so an install/remove/install sequence ends in the right state
 * and an update replaces the previous digest instead of leaving the oldest.
 */
export const installedProfiles = async (
  commands: ReadonlyArray<InstalledProfileCommand>,
): Promise<ReadonlyMap<string, string>> => {
  const installed = new Map<string, string>();

  for (const command of [...commands].reverse()) {
    if (command.requestType === "RemoveProfile") {
      const payload = Option.getOrUndefined(
        Schema.decodeUnknownOption(RemoveProfilePayload)(command.payload),
      );

      if (payload) installed.delete(payload.Identifier);
      continue;
    }

    if (command.requestType !== "InstallProfile") continue;

    const payload = Option.getOrUndefined(
      Schema.decodeUnknownOption(InstallProfilePayload)(command.payload),
    );

    if (!payload) continue;

    let bytes: Uint8Array;

    try {
      bytes = Uint8Array.from(atob(payload.Payload.replaceAll(/\s/g, "")), (char) =>
        char.charCodeAt(0),
      );
    } catch {
      continue;
    }

    const inspection = await inspectMobileconfig(bytes);

    if (inspection?.identifier) installed.set(inspection.identifier, await profileDigest(bytes));
  }

  return installed;
};
