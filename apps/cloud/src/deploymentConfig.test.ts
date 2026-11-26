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

describe("hosted device identity config", () => {
  it("keeps Node-only proxy-header trust disabled regardless of the deploy environment", () => {
    const config = read("cloudflare.config.ts");

    expect(config).toContain('TRUST_DEVICE_IDENTITY_HEADERS: bindings.text("")');
    expect(config).toContain('TRUSTED_DEVICE_IDENTITY_PEERS: bindings.text("")');
    expect(config).not.toContain(
      "TRUST_DEVICE_IDENTITY_HEADERS: bindings.text(process.env.TRUST_DEVICE_IDENTITY_HEADERS",
    );
  });

  it("keeps the hosted binding declarations in sync", () => {
    const declarations = read("cloudflare.config.d.ts");

    expect(declarations).toContain(
      'TRUST_DEVICE_IDENTITY_HEADERS: import("cf/config").TextBinding<"">',
    );
    expect(declarations).toContain(
      'TRUSTED_DEVICE_IDENTITY_PEERS: import("cf/config").TextBinding<"">',
    );
  });
});
