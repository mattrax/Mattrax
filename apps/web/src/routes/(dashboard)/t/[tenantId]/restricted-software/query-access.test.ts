import { describe, expect, it } from "vitest";
import { restrictedSoftwareQueryAccess } from "./query-access";

describe("restricted software query access", () => {
  it("denies every query before the read gate opens", () => {
    expect(
      restrictedSoftwareQueryAccess({
        read: false,
        write: true,
        isNew: false,
        violationsView: true,
      }),
    ).toEqual({ rules: false, violations: false, detail: false, targets: false });
  });

  it("allows read surfaces but not writer-only targets for a read-only member", () => {
    expect(
      restrictedSoftwareQueryAccess({
        read: true,
        write: false,
        isNew: false,
        violationsView: true,
      }),
    ).toEqual({ rules: true, violations: true, detail: true, targets: false });
  });

  it("waits for the violations tab before loading violations", () => {
    expect(
      restrictedSoftwareQueryAccess({
        read: true,
        write: true,
        isNew: true,
        violationsView: false,
      }),
    ).toEqual({ rules: true, violations: false, detail: false, targets: true });
  });

  it("loads detail and targets for a writer editing an existing rule", () => {
    expect(
      restrictedSoftwareQueryAccess({
        read: true,
        write: true,
        isNew: false,
        violationsView: false,
      }),
    ).toEqual({ rules: true, violations: false, detail: true, targets: true });
  });
});
