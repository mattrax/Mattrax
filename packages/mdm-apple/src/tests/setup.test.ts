import { describe, expect, it } from "vitest";
import { setupIsReady, setupReleaseBlockers } from "@mattrax/mdm-core";

const base = {
  awaitingConfiguration: true,
  configured: false,
  deliveryMode: "ddm" as const,
  expectedSetupPayload: true,
  isMac: true,
  declarations: [{ declarationType: "configurations", valid: "valid", active: true }],
  commands: [{ requestType: "AccountConfiguration", status: "succeeded" }],
};

describe("ADE setup release gating", () => {
  it("releases only after the local admin and every declaration are valid", () => {
    expect(setupIsReady(base)).toBe(true);
  });

  it("waits while the managed local admin is still being created", () => {
    expect(
      setupReleaseBlockers({
        ...base,
        commands: [{ requestType: "AccountConfiguration", status: "sent" }],
      }),
    ).toEqual(["local-admin-pending"]);
  });

  it("does not release when the local admin failed", () => {
    expect(
      setupReleaseBlockers({
        ...base,
        commands: [{ requestType: "AccountConfiguration", status: "failed" }],
      }),
    ).toEqual(["local-admin-failed"]);
  });

  it("waits for the first declaration report", () => {
    expect(setupReleaseBlockers({ ...base, declarations: [] })).toEqual(["declarations-missing"]);
  });

  it("does not release while any declaration is invalid or unknown", () => {
    expect(
      setupReleaseBlockers({
        ...base,
        declarations: [
          { declarationType: "configurations", valid: "valid" },
          { declarationType: "configurations", valid: "invalid" },
        ],
      }),
    ).toEqual(["declarations-invalid"]);

    expect(
      setupReleaseBlockers({
        ...base,
        declarations: [{ declarationType: "configurations", valid: "unknown" }],
      }),
    ).toEqual(["declarations-invalid"]);

    expect(
      setupReleaseBlockers({
        ...base,
        declarations: [{ declarationType: "configurations", valid: "valid", active: false }],
      }),
    ).toEqual(["declarations-invalid"]);
  });

  it("ignores non-policy declarations (assets) for the validity gate", () => {
    expect(
      setupReleaseBlockers({
        ...base,
        declarations: [{ declarationType: "assets", valid: "invalid" }],
      }),
    ).toEqual(["declarations-missing"]);
  });

  it("uses profile installs instead of declarations on the legacy path", () => {
    expect(
      setupIsReady({
        ...base,
        deliveryMode: "legacy",
        declarations: [],
        commands: [
          { requestType: "AccountConfiguration", status: "succeeded" },
          { requestType: "InstallProfile", status: "succeeded" },
        ],
      }),
    ).toBe(true);

    expect(
      setupReleaseBlockers({
        ...base,
        deliveryMode: "legacy",
        declarations: [],
        commands: [{ requestType: "InstallProfile", status: "queued" }],
      }),
    ).toEqual(["local-admin-pending", "profiles-pending"]);
  });

  it("never releases a device that is not awaiting configuration", () => {
    expect(setupIsReady({ ...base, awaitingConfiguration: false })).toBe(false);
  });

  it("does not require an account command on iOS", () => {
    expect(
      setupIsReady({
        ...base,
        isMac: false,
        commands: [],
      }),
    ).toBe(true);
  });

  it("releases when no policy payload is assigned to the device", () => {
    expect(
      setupIsReady({
        ...base,
        expectedSetupPayload: false,
        declarations: [],
      }),
    ).toBe(true);
  });
});
