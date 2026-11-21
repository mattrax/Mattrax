import { describe, expect, it } from "vitest";
import { EnterprisePreconditionErrors } from "./Errors.js";
import {
  parseUpdatedAtTimestamp,
  updatedAtPrecondition,
  updatedAtSatisfiesPrecondition,
} from "./Preconditions.js";

const stored = new Date("2026-11-20T10:15:30.123Z");

const at = (value: string) => updatedAtPrecondition({ expectedUpdatedAt: value });

describe("updatedAtPrecondition", () => {
  it("accepts a matching millisecond timestamp", () => {
    const precondition = at("2026-11-20T10:15:30.123Z");

    expect(precondition._tag).toBe("At");
    expect(updatedAtSatisfiesPrecondition(stored, precondition)).toBe(true);
  });

  it("rejects an older timestamp", () => {
    const precondition = at("2026-11-20T10:15:30.122Z");

    expect(updatedAtSatisfiesPrecondition(stored, precondition)).toBe(false);
  });

  it("rejects a newer timestamp", () => {
    const precondition = at("2026-11-20T10:15:30.124Z");

    expect(updatedAtSatisfiesPrecondition(stored, precondition)).toBe(false);
  });

  it("allows a missing precondition", () => {
    expect(updatedAtPrecondition({})._tag).toBe("Missing");
    expect(updatedAtSatisfiesPrecondition(stored, updatedAtPrecondition({}))).toBe(true);
  });

  it("rejects an invalid timestamp", () => {
    for (const value of ["not-a-date", "2026-13-40T99:99:99.000Z", "  "]) {
      const precondition = at(value);

      expect(precondition._tag).toBe("Invalid");
      expect(updatedAtSatisfiesPrecondition(stored, precondition)).toBe(false);
    }
  });

  it("prefers the body over the header", () => {
    const precondition = updatedAtPrecondition({
      expectedUpdatedAt: "2026-11-20T10:15:30.123Z",
      ifUnmodifiedSince: "Wed, 20 Nov 2026 10:15:30 GMT",
    });

    expect(precondition).toMatchObject({ _tag: "At", timestamp: { precision: "millisecond" } });
  });

  it("falls back to the If-Unmodified-Since header", () => {
    const precondition = updatedAtPrecondition({
      ifUnmodifiedSince: "Wed, 20 Nov 2026 10:15:30 GMT",
    });

    expect(precondition).toMatchObject({ _tag: "At", timestamp: { precision: "second" } });
    // HTTP dates lose the milliseconds, so the comparison is whole seconds.
    expect(updatedAtSatisfiesPrecondition(stored, precondition)).toBe(true);
    expect(updatedAtSatisfiesPrecondition(new Date("2026-11-20T10:15:31.000Z"), precondition)).toBe(
      false,
    );
  });

  it("does not fall back when a supplied body value is malformed", () => {
    const precondition = updatedAtPrecondition({
      expectedUpdatedAt: "yesterday",
      ifUnmodifiedSince: "Wed, 20 Nov 2026 10:15:30 GMT",
    });

    expect(precondition._tag).toBe("Invalid");
  });
});

describe("precondition error contract", () => {
  it("maps a stale write to HTTP 412", () => {
    expect(EnterprisePreconditionErrors[0].ast.context?.annotations?.httpApiStatus).toBe(412);
  });
});

describe("parseUpdatedAtTimestamp", () => {
  it("records millisecond precision only for fractional ISO timestamps", () => {
    expect(parseUpdatedAtTimestamp("2026-11-20T10:15:30.123Z")?.precision).toBe("millisecond");
    expect(parseUpdatedAtTimestamp("2026-11-20T10:15:30Z")?.precision).toBe("second");
    expect(parseUpdatedAtTimestamp("Wed, 20 Nov 2026 10:15:30 GMT")?.precision).toBe("second");
    expect(parseUpdatedAtTimestamp("2026-11-20")?.precision).toBe("second");
  });

  it("normalises offsets to the same instant", () => {
    const utc = parseUpdatedAtTimestamp("2026-11-20T10:15:30.123Z");
    const offset = parseUpdatedAtTimestamp("2026-11-20T11:15:30.123+01:00");

    expect(offset?.at.getTime()).toBe(utc?.at.getTime());
  });
});
