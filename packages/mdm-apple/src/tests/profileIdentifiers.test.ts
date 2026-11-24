import { describe, expect, it } from "vitest";
import { profileDigest } from "../legacyDelivery.js";
import {
  buildRestrictedSoftwareProfile,
  buildScriptProfile,
  planRestrictedSoftwareProfileChanges,
  restrictedSoftwareProfileDocumentIdentifier,
  scriptProfileDocumentIdentifier,
} from "@mattrax/dm-apple";

const input = {
  serverUrl: "https://mattrax.test/api",
  deviceToken: "mttx_sa1_test",
};

describe("agent profile identifiers", () => {
  it("keys a restricted-software profile by the outer PayloadIdentifier", async () => {
    const profile = await buildRestrictedSoftwareProfile({
      ...input,
      ruleId: "rule-1",
      name: "Block example",
      matchType: "bundle-id",
      matchValue: "com.example.Banned",
      action: "delete-app",
      intervalSeconds: 300,
    });
    const documentIdentifier = restrictedSoftwareProfileDocumentIdentifier("rule-1");
    const text = new TextDecoder().decode(profile);

    expect(text).toContain(`<string>${documentIdentifier}</string>`);

    const digest = await profileDigest(profile);
    const changes = planRestrictedSoftwareProfileChanges(
      [
        {
          ruleId: "rule-1",
          identifier: documentIdentifier,
          digest,
          profile,
        },
      ],
      new Map([[documentIdentifier, digest]]),
    );

    expect(changes.install).toEqual([]);
    expect(changes.remove).toEqual([]);
  });

  it("keys a script profile by the outer PayloadIdentifier", async () => {
    const profile = await buildScriptProfile({
      ...input,
      scriptId: "script-1",
      name: "Inventory",
      language: "sh",
      body: "echo ok",
      runAs: "root",
      timeoutSeconds: 60,
      environment: [],
      trigger: { type: "interval", intervalSeconds: 60 },
    });
    const documentIdentifier = scriptProfileDocumentIdentifier("script-1");
    const text = new TextDecoder().decode(profile);

    expect(text).toContain(`<string>${documentIdentifier}</string>`);
    expect(documentIdentifier).toBe("com.mattrax.script.script-1.profile");
  });
});
