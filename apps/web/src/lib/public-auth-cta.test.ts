import { describe, expect, it } from "vitest";
import { publicPrimaryCta } from "./public-auth-cta";

describe("public primary CTA", () => {
  it("is neutral while the session is pending", () => {
    expect(publicPrimaryCta(true, false)).toBeUndefined();
    expect(publicPrimaryCta(true, true)).toBeUndefined();
  });

  it("sends a signed-out visitor to registration", () => {
    expect(publicPrimaryCta(false, false)).toEqual({
      label: "Start free",
      href: "/register",
    });
  });

  it("sends a signed-in visitor to the dashboard", () => {
    expect(publicPrimaryCta(false, true)).toEqual({
      label: "Open dashboard",
      href: "/dashboard",
    });
  });
});
