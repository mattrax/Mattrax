import { describe, expect, it } from "vitest";
import { deviceRestrictedSoftwareQueryEnabled } from "./restricted-software-query";

describe("device restricted software query access", () => {
  it("loads only for a readable device overview", () => {
    expect(
      deviceRestrictedSoftwareQueryEnabled({ canRead: true, overview: true, hasDevice: true }),
    ).toBe(true);
  });

  it("does not load without restricted-software read permission", () => {
    expect(
      deviceRestrictedSoftwareQueryEnabled({ canRead: false, overview: true, hasDevice: true }),
    ).toBe(false);
  });

  it("waits until the overview tab is active", () => {
    expect(
      deviceRestrictedSoftwareQueryEnabled({ canRead: true, overview: false, hasDevice: true }),
    ).toBe(false);
  });

  it("does not load before a device id is available", () => {
    expect(
      deviceRestrictedSoftwareQueryEnabled({ canRead: true, overview: true, hasDevice: false }),
    ).toBe(false);
  });
});
