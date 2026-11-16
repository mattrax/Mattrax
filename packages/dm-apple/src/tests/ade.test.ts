import { describe, expect, it } from "vitest";
import { parseAppleAdeMachineInfo } from "../ade.js";

describe("ADE MachineInfo verification", () => {
  it("rejects an empty request", async () => {
    await expect(parseAppleAdeMachineInfo(new Uint8Array())).rejects.toThrow(/empty/i);
  });

  it("rejects a body that is not CMS SignedData", async () => {
    await expect(
      parseAppleAdeMachineInfo(new TextEncoder().encode("<plist></plist>")),
    ).rejects.toThrow(/CMS SignedData/i);
  });

  it("rejects a request larger than the parser limit", async () => {
    await expect(parseAppleAdeMachineInfo(new Uint8Array(64 * 1024 + 1))).rejects.toThrow(
      /too large/i,
    );
  });
});
