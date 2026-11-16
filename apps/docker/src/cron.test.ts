import { describe, expect, it } from "vitest";
import { parseCron } from "./cron.ts";

describe("cron", () => {
  it("evaluates expressions in UTC, like the platform", () => {
    const daily = parseCron("17 3 * * *");

    expect(daily(new Date("2026-01-01T03:17:00Z"))).toBe(true);
    expect(daily(new Date("2026-01-01T04:17:00Z"))).toBe(false);
  });

  it("matches Sunday as day 0", () => {
    // 2026-01-04 is a Sunday.
    expect(parseCron("0 9 * * 0")(new Date("2026-01-04T09:00:00Z"))).toBe(true);
    expect(parseCron("0 9 * * 1")(new Date("2026-01-04T09:00:00Z"))).toBe(false);
  });

  it("accepts the Cloudflare daily and hourly triggers", () => {
    expect(parseCron("17 3 * * *")(new Date("2026-11-16T03:17:00Z"))).toBe(true);
    expect(parseCron("47 * * * *")(new Date("2026-11-16T14:47:00Z"))).toBe(true);
  });
});
