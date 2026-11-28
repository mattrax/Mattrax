import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { DeviceId, newId, TenantId } from "../src/index.ts";

describe("typed identifiers", () => {
  it("generates a prefixed identifier with a fresh suffix", () => {
    const first = TenantId.make();
    const second = TenantId.make();

    expect(first).toMatch(/^tn_[0-9a-f]{24}$/);
    expect(first).not.toBe(second);
    expect(newId()).toMatch(/^[0-9a-f]{24}$/);
  });

  it("keeps identifier kinds distinct at runtime", () => {
    const tenant = TenantId.make();

    expect(TenantId.is(tenant)).toBe(true);
    expect(DeviceId.is(tenant)).toBe(false);
    expect(Schema.is(TenantId.schema)(tenant)).toBe(true);
    expect(Schema.is(DeviceId.schema)(tenant)).toBe(false);
  });

  it("brands URL segments without changing their value", () => {
    expect(TenantId.fromParam("legacy-segment")).toBe("legacy-segment");
  });

  it("rejects mixing identifier kinds at compile time", () => {
    const tenant = TenantId.make();
    // @ts-expect-error a tenant id is not a device id
    const device: DeviceId = tenant;
    expect(device).toBe(tenant);
  });
});
