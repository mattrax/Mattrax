import { describe, expect, it } from "vitest";
import {
  WINDOWS_POLICY_RETRY_MS,
  planWindowsPolicyDelivery,
  windowsCommandOutcome,
  windowsInventoryCommandRowId,
  windowsPolicyCommandId,
  windowsPolicyNodeHash,
  windowsPolicyRejectionDetail,
} from "../windowsCommands.js";

const node = (uri: string, hash: string) => ({ uri, hash });

describe("planWindowsPolicyDelivery", () => {
  const now = new Date("2026-01-01T12:00:00Z");

  it("delivers a node that was never sent", () => {
    const plan = planWindowsPolicyDelivery({
      desired: new Map([["urn:a", node("urn:a", "h1")]]),
      delivered: [],
      applied: [],
      failures: [],
      now,
    });

    expect(plan).toEqual({ replace: [{ uri: "urn:a", hash: "h1" }], remove: [] });
  });

  it("does not re-send an acknowledged unchanged node", () => {
    const plan = planWindowsPolicyDelivery({
      desired: new Map([["urn:a", node("urn:a", "h1")]]),
      delivered: [node("urn:a", "h1")],
      applied: ["urn:a"],
      failures: [],
      now,
    });

    expect(plan).toEqual({ replace: [], remove: [] });
  });

  it("re-sends a delivered node the device never acknowledged", () => {
    const plan = planWindowsPolicyDelivery({
      desired: new Map([["urn:a", node("urn:a", "h1")]]),
      delivered: [node("urn:a", "h1")],
      applied: [],
      failures: [],
      now,
    });

    expect(plan.replace).toEqual([{ uri: "urn:a", hash: "h1" }]);
  });

  it("re-sends a node whose value changed", () => {
    const plan = planWindowsPolicyDelivery({
      desired: new Map([["urn:a", node("urn:a", "h2")]]),
      delivered: [node("urn:a", "h1")],
      applied: ["urn:a"],
      failures: [],
      now,
    });

    expect(plan.replace).toEqual([{ uri: "urn:a", hash: "h2" }]);
  });

  it("deletes nodes that left every policy, including unacknowledged ones", () => {
    const plan = planWindowsPolicyDelivery({
      desired: new Map([["urn:b", node("urn:b", "h2")]]),
      delivered: [node("urn:a", "h1"), node("urn:b", "h2")],
      applied: ["urn:b"],
      failures: [],
      now,
    });

    expect(plan).toEqual({ replace: [], remove: ["urn:a"] });
  });

  it("keeps a recent rejection visible but retries after the window", () => {
    const failure = {
      uri: "urn:a",
      hash: "h1",
      resultStatus: "400",
      detail: windowsPolicyRejectionDetail("urn:a", "400"),
      at: new Date(now.getTime() - WINDOWS_POLICY_RETRY_MS / 2).toISOString(),
    };

    const recent = planWindowsPolicyDelivery({
      desired: new Map([["urn:a", node("urn:a", "h1")]]),
      delivered: [node("urn:a", "h1")],
      applied: [],
      failures: [failure],
      now,
    });

    expect(recent.replace).toEqual([]);

    const after = planWindowsPolicyDelivery({
      desired: new Map([["urn:a", node("urn:a", "h1")]]),
      delivered: [node("urn:a", "h1")],
      applied: [],
      failures: [failure],
      now: new Date(now.getTime() + WINDOWS_POLICY_RETRY_MS),
    });

    expect(after.replace).toEqual([{ uri: "urn:a", hash: "h1" }]);
  });

  it("retries immediately when the value changed after a rejection", () => {
    const plan = planWindowsPolicyDelivery({
      desired: new Map([["urn:a", node("urn:a", "h2")]]),
      delivered: [node("urn:a", "h1")],
      applied: [],
      failures: [
        {
          uri: "urn:a",
          hash: "h1",
          resultStatus: "400",
          detail: "rejected",
          at: now.toISOString(),
        },
      ],
      now,
    });

    expect(plan.replace).toEqual([{ uri: "urn:a", hash: "h2" }]);
  });
});

describe("windows command identities", () => {
  it("derives stable, device-scoped command ids", async () => {
    const first = await windowsPolicyCommandId("device-1", "replace", "urn:a");
    const second = await windowsPolicyCommandId("device-1", "replace", "urn:a");
    const otherDevice = await windowsPolicyCommandId("device-2", "replace", "urn:a");

    expect(first).toBe(second);
    expect(first).not.toBe(otherDevice);
    expect(first.startsWith("winp-r-")).toBe(true);

    const inventory = await windowsInventoryCommandRowId("device-1", "windows-inventory-serial");

    expect(inventory).toMatch(/^winv-[0-9a-f]{32}$/);
  });

  it("hashes the value and format together", async () => {
    const value = await windowsPolicyNodeHash("1", "int");

    expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(await windowsPolicyNodeHash("1", "chr")).not.toBe(value);
    expect(await windowsPolicyNodeHash("2", "int")).not.toBe(value);
  });
});

describe("windowsCommandOutcome", () => {
  it("maps SyncML statuses onto the shared lifecycle", () => {
    expect(windowsCommandOutcome("200")).toEqual({ status: "succeeded", resultStatus: "200" });
    expect(windowsCommandOutcome("418")).toEqual({ status: "queued", resultStatus: "418" });
    expect(windowsCommandOutcome("500")).toEqual({ status: "failed", resultStatus: "500" });
    expect(windowsCommandOutcome("")).toEqual({ status: "failed", resultStatus: "unknown" });
  });

  it("names the rejected OMA-URI in the detail", () => {
    expect(windowsPolicyRejectionDetail("urn:a", "400")).toContain("urn:a");
    expect(windowsPolicyRejectionDetail("urn:a", "400")).toContain("400");
  });
});
