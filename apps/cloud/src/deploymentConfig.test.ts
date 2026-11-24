import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (name: string) => readFileSync(join(root, name), "utf8");

const BRAND_VARIABLES = [
  "MATTRAX_BRAND_NAME",
  "MATTRAX_BRAND_LOGO_URL",
  "MATTRAX_BRAND_COLOR",
] as const;

describe("deployment branding config", () => {
  it("declares every brand binding in the Cloudflare config", () => {
    const config = read("cloudflare.config.ts");

    for (const name of BRAND_VARIABLES) expect(config).toContain(`${name}: bindings.text`);
  });

  it("keeps the generated config declarations in sync", () => {
    const declarations = read("cloudflare.config.d.ts");

    for (const name of BRAND_VARIABLES) expect(declarations).toContain(`${name}: import`);
  });
});
