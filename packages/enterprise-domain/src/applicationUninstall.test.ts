import { describe, expect, it } from "vitest";
import {
  APPLICATION_UNINSTALL_DEADLINE_MS,
  planApplicationUninstallReconciliation,
  sameApplicationBundle,
} from "./applicationUninstall.js";

const at = new Date("2026-11-20T12:00:00.000Z");

const queued = (
  overrides: Partial<Parameters<typeof planApplicationUninstallReconciliation>[0][number]> = {},
) => ({
  id: "uninstall-1",
  applicationId: "app-1",
  platform: "apple" as const,
  bundleId: "com.example.app",
  status: "queued" as const,
  deadline: new Date(at.getTime() + APPLICATION_UNINSTALL_DEADLINE_MS),
  commandId: "command-1",
  ...overrides,
});

describe("application uninstall reconciliation", () => {
  it("succeeds when the app is gone from the reported inventory", () => {
    const transitions = planApplicationUninstallReconciliation(
      [queued()],
      [{ bundleId: "com.other.app", version: "1.0" }],
      at,
    );

    expect(transitions).toEqual([
      {
        id: "uninstall-1",
        applicationId: "app-1",
        platform: "apple",
        bundleId: "com.example.app",
        status: "succeeded",
        resultDetail: "The application is no longer in the inventory the device reported.",
        commandId: "command-1",
      },
    ]);
  });

  it("waits while the app is still present before the deadline", () => {
    expect(
      planApplicationUninstallReconciliation(
        [queued()],
        [{ bundleId: "com.example.app", version: "2.1" }],
        at,
      ),
    ).toEqual([]);
  });

  it("fails with the observed version after the deadline", () => {
    const transitions = planApplicationUninstallReconciliation(
      [
        queued({
          deadline: new Date(at.getTime() - 1),
          adamId: "361309726",
        }),
      ],
      [{ bundleId: "com.example.app", version: "2.1" }],
      at,
    );

    expect(transitions).toMatchObject([
      {
        status: "failed",
        observedVersion: "2.1",
        adamId: "361309726",
        resultDetail:
          "The application is still installed at version 2.1 after the uninstall deadline.",
      },
    ]);
  });

  it("matches Windows product codes without braces or case", () => {
    expect(
      sameApplicationBundle(
        "win",
        "{8A69D345-D564-463C-AFF1-A69D9E530F96}",
        "8a69d345-d564-463c-aff1-a69d9e530f96",
      ),
    ).toBe(true);
    expect(sameApplicationBundle("apple", "com.example.App", "com.example.app")).toBe(false);

    expect(
      planApplicationUninstallReconciliation(
        [
          queued({
            platform: "win",
            bundleId: "{8A69D345-D564-463C-AFF1-A69D9E530F96}",
            deadline: new Date(at.getTime() - 1),
          }),
        ],
        [{ bundleId: "8a69d345-d564-463c-aff1-a69d9e530f96", version: "120.0" }],
        at,
      ),
    ).toMatchObject([{ status: "failed", observedVersion: "120.0" }]);
  });

  it("ignores rows that already reached a terminal state", () => {
    expect(
      planApplicationUninstallReconciliation([queued({ status: "succeeded" })], [], at),
    ).toEqual([]);
  });
});
