/**
 * Apple script profile delivery.
 *
 * Every assigned script becomes one `.mobileconfig` with a
 * `com.mattrax.script` payload. The profile identifier is derived from the
 * script id, so installing an updated profile replaces the old one instead of
 * accumulating copies. The diff is computed from the device's command history
 * (the same source policy delivery uses), so no extra state table is needed.
 */

export type DesiredScriptProfile = {
  readonly scriptId: string;
  readonly identifier: string;
  /** SHA-256 of the encoded profile bytes. */
  readonly digest: string;
  readonly profile: Uint8Array;
};

export type ScriptProfileChanges = {
  /** Profiles to install, or reinstall because content changed. */
  readonly install: ReadonlyArray<DesiredScriptProfile>;
  /** Identifiers of script profiles no longer assigned. */
  readonly remove: ReadonlyArray<string>;
};

/** Profile identifiers owned by script delivery, not by policy delivery. */
export const SCRIPT_PROFILE_IDENTIFIER_PREFIX = "com.mattrax.script.";

export const isScriptProfileIdentifier = (identifier: string): boolean =>
  identifier.startsWith(SCRIPT_PROFILE_IDENTIFIER_PREFIX);

/**
 * Compare desired script profiles with the ones the device installed. A
 * profile whose bytes changed (body, trigger, environment or a new manual run
 * id) is reinstalled. Installed script profiles that are no longer desired are
 * removed, including every one when the tenant disables scripts.
 */
export const planScriptProfileChanges = (
  desired: ReadonlyArray<DesiredScriptProfile>,
  installed: ReadonlyMap<string, string>,
): ScriptProfileChanges => {
  const install = desired.filter((profile) => installed.get(profile.identifier) !== profile.digest);

  const remove = [...installed.keys()]
    .filter(
      (identifier) =>
        isScriptProfileIdentifier(identifier) &&
        !desired.some((profile) => profile.identifier === identifier),
    )
    .sort();

  return { install, remove };
};
