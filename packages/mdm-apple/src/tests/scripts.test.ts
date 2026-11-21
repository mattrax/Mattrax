import { describe, expect, it } from "vitest";
import {
  SCRIPT_PROFILE_IDENTIFIER_PREFIX,
  isScriptProfileIdentifier,
  planScriptProfileChanges,
} from "@mattrax/mdm-core";
import type { DesiredScriptProfile } from "@mattrax/mdm-core";

const profile = (scriptId: string, digest: string): DesiredScriptProfile => ({
  scriptId,
  identifier: `${SCRIPT_PROFILE_IDENTIFIER_PREFIX}${scriptId}`,
  digest,
  profile: new Uint8Array(),
});

describe("script profile delivery plan", () => {
  it("installs a profile the device has never seen", () => {
    const changes = planScriptProfileChanges([profile("one", "a")], new Map());

    expect(changes.install.map((entry) => entry.scriptId)).toEqual(["one"]);
    expect(changes.remove).toEqual([]);
  });

  it("skips an unchanged profile and reinstalls a changed one", () => {
    const installed = new Map([
      [`${SCRIPT_PROFILE_IDENTIFIER_PREFIX}one`, "a"],
      [`${SCRIPT_PROFILE_IDENTIFIER_PREFIX}two`, "old"],
    ]);

    const changes = planScriptProfileChanges(
      [profile("one", "a"), profile("two", "new")],
      installed,
    );

    expect(changes.install.map((entry) => entry.scriptId)).toEqual(["two"]);
    expect(changes.remove).toEqual([]);
  });

  it("removes script profiles that are no longer assigned", () => {
    const installed = new Map([
      [`${SCRIPT_PROFILE_IDENTIFIER_PREFIX}gone`, "a"],
      [`${SCRIPT_PROFILE_IDENTIFIER_PREFIX}kept`, "b"],
    ]);

    const changes = planScriptProfileChanges([profile("kept", "b")], installed);

    expect(changes.remove).toEqual([`${SCRIPT_PROFILE_IDENTIFIER_PREFIX}gone`]);
  });

  it("never removes a policy profile that happens to be installed", () => {
    const installed = new Map([
      ["app.mattrax.policy.legacy", "x"],
      [`${SCRIPT_PROFILE_IDENTIFIER_PREFIX}gone`, "a"],
    ]);

    expect(planScriptProfileChanges([], installed).remove).toEqual([
      `${SCRIPT_PROFILE_IDENTIFIER_PREFIX}gone`,
    ]);
  });

  it("removes every script profile when the tenant disables scripts", () => {
    const installed = new Map([
      [`${SCRIPT_PROFILE_IDENTIFIER_PREFIX}one`, "a"],
      [`${SCRIPT_PROFILE_IDENTIFIER_PREFIX}two`, "b"],
    ]);

    expect(planScriptProfileChanges([], installed).remove).toHaveLength(2);
  });

  it("recognises only the script prefix", () => {
    expect(isScriptProfileIdentifier(`${SCRIPT_PROFILE_IDENTIFIER_PREFIX}x`)).toBe(true);
    expect(isScriptProfileIdentifier("app.mattrax.p.x")).toBe(false);
  });
});
