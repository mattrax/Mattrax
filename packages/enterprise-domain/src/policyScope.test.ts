import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { enterpriseAttributeApi } from "./Http/AttributeApi.ts";
import { GroupScopeSummary, PolicyScopeSummary } from "./PolicyScope.ts";

const decodePolicyScope = Schema.decodeUnknownSync(PolicyScopeSummary);

describe("policy scope contract", () => {
  it("is served by the attribute group, not the main API group", () => {
    expect(enterpriseAttributeApi.endpoints.getPolicyScope).toBeDefined();
    expect(enterpriseAttributeApi.endpoints.getGroupScope).toBeDefined();
  });

  it("decodes a detailed reverse-scope response", () => {
    const scope = decodePolicyScope({
      policyId: "policy-1",
      platforms: ["apple"],
      apple: [{ family: "macOS", minimum: "14.0" }],
      windowsMinimum: null,
      channels: ["device"],
      deviceCount: 2,
      devices: [
        {
          deviceId: "device-1",
          deviceName: "Oscar's Mac",
          platform: "apple",
          deviceOs: "macOS 14.2",
          channel: "device",
          status: "applies",
          reason: "applies",
          kinds: ["mttx.apple.device"],
          unsupportedKinds: [],
          losses: [],
          exclusions: [],
        },
        {
          deviceId: "device-2",
          deviceName: "Studio",
          platform: "apple",
          deviceOs: "macOS 13.6",
          channel: "device",
          status: "overridden",
          reason: "higher-priority",
          kinds: [],
          unsupportedKinds: ["mttx.apple.certificate.cert"],
          losses: [
            {
              kind: "mttx.apple.device",
              reason: "higher-priority",
              winnerPolicyId: "policy-2",
              winnerPolicyName: "Security",
              winnerPriority: 10,
            },
          ],
          exclusions: [
            {
              reason: "group-exclude",
              groupId: "group-1",
              groupName: "Contractors",
              effective: true,
            },
          ],
        },
      ],
    });

    expect(scope.devices[1]).toMatchObject({
      status: "overridden",
      reason: "higher-priority",
      losses: [expect.objectContaining({ winnerPolicyName: "Security" })],
    });
  });

  it("decodes a group scope response", () => {
    const group = Schema.decodeUnknownSync(GroupScopeSummary)({
      groupId: "group-1",
      memberCount: 1,
      policies: [
        {
          policyId: "policy-1",
          policyName: "Security",
          mode: "include",
          devices: [
            {
              deviceId: "device-1",
              deviceName: "Oscar's Mac",
              platform: "apple",
              channel: "user",
              userId: "user-1",
              userName: "Oscar",
              status: "partial",
              reason: "os-unsupported",
              kinds: ["mttx.apple.device"],
              unsupportedKinds: ["mttx.apple.certificate.cert"],
              losses: [],
              exclusions: [],
            },
          ],
        },
      ],
    });

    expect(group.policies[0]?.devices[0]).toMatchObject({
      channel: "user",
      status: "partial",
    });
  });
});
