import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const compose = readFileSync(join(import.meta.dirname, "..", "docker-compose.yml"), "utf8");

describe("self-hosted compose configuration", () => {
  it("passes deployment branding through to the container", () => {
    for (const name of ["MATTRAX_BRAND_NAME", "MATTRAX_BRAND_LOGO_URL", "MATTRAX_BRAND_COLOR"])
      expect(compose).toContain(`${name}: \${${name}:-}`);
  });
});
