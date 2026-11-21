import { describe, expect, it } from "vitest";
import { compareVersions, installerSkipReason, selectInstaller } from "@mattrax/enterprise-domain";

const installer = (overrides: {
  id: string;
  version?: string | null;
  minOsVersion?: string | null;
  requiredCapability?: string | null;
  priority?: number;
  platform?: "apple" | "win" | "android";
  source?: "manifest" | "store" | "upload";
}) => ({
  id: overrides.id,
  platform: overrides.platform ?? ("apple" as const),
  source: overrides.source ?? ("manifest" as const),
  version: overrides.version ?? null,
  minOsVersion: overrides.minOsVersion ?? null,
  requiredCapability: overrides.requiredCapability ?? null,
  priority: overrides.priority ?? 0,
});

const device = (
  overrides: {
    proto?: "apple" | "win" | "android";
    osVersion?: string | null;
    capabilities?: ReadonlyArray<string> | null;
  } = {},
) => ({
  proto: overrides.proto ?? ("apple" as const),
  osVersion: overrides.osVersion ?? null,
  capabilities: overrides.capabilities ?? null,
});

describe("application installer selection", () => {
  it("prefers priority, then the highest version", () => {
    const selected = selectInstaller(
      [
        installer({ id: "old", version: "1.0" }),
        installer({ id: "new", version: "2.0" }),
        installer({ id: "preferred", version: "1.5", priority: 5 }),
      ],
      device({ osVersion: "15.0" }),
    );

    expect(selected?.id).toBe("preferred");
  });

  it("filters by platform, minimum OS and capability", () => {
    const installers = [
      installer({ id: "legacy", minOsVersion: "13.0" }),
      installer({ id: "modern", minOsVersion: "17.0" }),
      installer({ id: "vpp", requiredCapability: "vpp", priority: 10 }),
      installer({ id: "win", platform: "win" }),
    ];

    expect(selectInstaller(installers, device({ osVersion: "16.4" }))?.id).toBe("legacy");
    expect(
      selectInstaller(installers, device({ osVersion: "17.1", capabilities: ["vpp"] }))?.id,
    ).toBe("vpp");
    expect(selectInstaller(installers, device({ osVersion: "17.1", capabilities: [] }))?.id).toBe(
      "legacy",
    );
    expect(selectInstaller(installers, device({ proto: "win", osVersion: "10.0" }))?.id).toBe(
      "win",
    );
  });

  it("does not guess when the OS version or capability is not reported", () => {
    const installers = [installer({ id: "min", minOsVersion: "15.0" })];

    expect(selectInstaller(installers, device({ osVersion: null }))).toBeUndefined();
    expect(
      selectInstaller(
        [installer({ id: "cap", requiredCapability: "vpp" })],
        device({ osVersion: "17.0", capabilities: null }),
      ),
    ).toBeUndefined();
  });

  it("explains why nothing matched", () => {
    expect(installerSkipReason([], device())).toContain("no installers");
    expect(installerSkipReason([installer({ id: "win", platform: "win" })], device())).toContain(
      "targets apple",
    );
    expect(
      installerSkipReason(
        [installer({ id: "new", minOsVersion: "18.0" })],
        device({ osVersion: "17.0" }),
      ),
    ).toContain("supports apple 17.0");
  });

  it("compares dotted versions numerically", () => {
    expect(compareVersions("15.10", "15.9")).toBeGreaterThan(0);
    expect(compareVersions("14.0.1", "14.0")).toBeGreaterThan(0);
    expect(compareVersions("17", "17.0")).toBe(0);
  });
});
