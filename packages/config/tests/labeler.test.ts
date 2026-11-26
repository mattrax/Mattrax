import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type LabelerRule = {
  readonly "changed-files": ReadonlyArray<{
    readonly "any-glob-to-any-file": ReadonlyArray<string>;
  }>;
};

const labeler = parse(
  readFileSync(new URL("../../../.github/labeler.yml", import.meta.url), "utf8"),
) as Record<string, ReadonlyArray<LabelerRule>>;

const globsFor = (label: string): ReadonlyArray<string> =>
  labeler[label]?.flatMap((rule) =>
    rule["changed-files"].flatMap((changed) => changed["any-glob-to-any-file"]),
  ) ?? [];

describe("domain labeler globs", () => {
  it("covers the current Apple MDM packages", () => {
    expect(globsFor("appledm")).toEqual(
      expect.arrayContaining(["packages/mdm-apple/**", "packages/mdm-core/**"]),
    );
  });

  it("covers the current Windows MDM packages", () => {
    expect(globsFor("windm")).toEqual(
      expect.arrayContaining(["packages/mdm-windows/**", "packages/mdm-core/**"]),
    );
  });

  it("does not point at removed package or app paths", () => {
    const globs = Object.values(labeler).flatMap((rules) =>
      rules.flatMap((rule) =>
        rule["changed-files"].flatMap((changed) => changed["any-glob-to-any-file"]),
      ),
    );

    expect(globs).not.toContain("packages/management-backend-enterprise/src/windows.ts");
    expect(globs).not.toContain("apps/cloud/src/android.ts");
    expect(globs).not.toContain("apps/apns-relay/**");
    expect(globs).not.toContain("packages/enterprise-backend/src/autopilot.ts");
  });
});
