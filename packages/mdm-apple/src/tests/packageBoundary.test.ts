import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

describe("mdm-apple package boundary", () => {
  it("does not wildcard re-export shared or Windows packages", () => {
    expect(source).not.toContain('export * from "@mattrax/mdm-core"');
    expect(source).not.toContain('export * from "@mattrax/mdm-windows"');
  });
});
