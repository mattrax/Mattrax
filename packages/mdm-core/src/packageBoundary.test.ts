import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { readonly dependencies?: Readonly<Record<string, string>> };

const sourceFiles = readdirSync(new URL("./", import.meta.url), { recursive: true }).filter(
  (entry): entry is string =>
    typeof entry === "string" && entry.endsWith(".ts") && !entry.endsWith(".test.ts"),
);

describe("mdm-core package boundary", () => {
  it("does not depend on the Apple protocol package", () => {
    expect(packageJson.dependencies?.["@mattrax/dm-apple"]).toBeUndefined();
  });

  it("does not import the Apple protocol package from source", () => {
    for (const entry of sourceFiles) {
      const source = readFileSync(fileURLToPath(new URL(entry, import.meta.url)), "utf8");

      expect(source, entry).not.toContain("@mattrax/dm-apple");
    }
  });
});
