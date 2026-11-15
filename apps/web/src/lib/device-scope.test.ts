import { describe, expect, it } from "vitest";
import {
  policyDeclarationIdentifier,
  policyDeliveryLabel,
  policyDeliveryState,
  splitPolicyDeclarationIdentifier,
} from "./device-scope";

const declaration = (identifier: string, valid: string, active: boolean) => ({
  identifier,
  valid,
  active,
});

describe("policy declaration identifiers", () => {
  it("round-trips a policy id and a kind that contains a colon", () => {
    const identifier = policyDeclarationIdentifier("policy_1", "mttx.apple.custom:a");

    expect(identifier).toBe("policy_1:mttx.apple.custom:a");
    expect(splitPolicyDeclarationIdentifier(identifier)).toEqual({
      policyId: "policy_1",
      kind: "mttx.apple.custom:a",
    });
  });
});

describe("policyDeliveryState", () => {
  const base = {
    policyId: "policy_1",
    kinds: ["a", "b"],
    tracked: true,
  };

  it("reports delivered only when every configuration kind is valid and active", () => {
    expect(
      policyDeliveryState({
        ...base,
        declarations: [
          declaration("policy_1:a", "valid", true),
          declaration("policy_1:b", "valid", true),
          declaration("other:a", "invalid", false),
        ],
      }),
    ).toBe("delivered");
  });

  it("surfaces the state the operator has to act on", () => {
    expect(
      policyDeliveryState({
        ...base,
        declarations: [declaration("policy_1:a", "valid", true)],
      }),
    ).toBe("pending");
    expect(
      policyDeliveryState({
        ...base,
        declarations: [
          declaration("policy_1:a", "invalid", true),
          declaration("policy_1:b", "valid", true),
        ],
      }),
    ).toBe("failed");
    expect(
      policyDeliveryState({
        ...base,
        declarations: [
          declaration("policy_1:a", "valid", false),
          declaration("policy_1:b", "valid", true),
        ],
      }),
    ).toBe("inactive");
  });

  it("does not claim delivery for platforms without DDM declarations", () => {
    expect(
      policyDeliveryState({
        ...base,
        tracked: false,
        declarations: [declaration("policy_1:a", "valid", true)],
      }),
    ).toBe("not-tracked");
  });
});

describe("policyDeliveryLabel", () => {
  it("uses plain English for every state", () => {
    expect(policyDeliveryLabel("delivered")).toBe("Delivered");
    expect(policyDeliveryLabel("pending")).toBe("Pending");
    expect(policyDeliveryLabel("failed")).toBe("Delivery failed");
    expect(policyDeliveryLabel("inactive")).toBe("Inactive on device");
    expect(policyDeliveryLabel("not-tracked")).toBe("Not tracked");
  });
});
