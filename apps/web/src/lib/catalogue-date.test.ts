import { describe, expect, it } from "vitest";
import { formatCatalogueVerifiedAt } from "./catalogue-date";

describe("catalogue verification date", () => {
  it("formats a date-only value in UTC", () => {
    expect(formatCatalogueVerifiedAt("2026-11-24")).toBe("24 Nov 2026");
    expect(formatCatalogueVerifiedAt("2026-01-01")).toBe("1 Jan 2026");
  });

  it("leaves an empty or unparseable value alone", () => {
    expect(formatCatalogueVerifiedAt()).toBe("");
    expect(formatCatalogueVerifiedAt("not-a-date")).toBe("not-a-date");
  });
});
