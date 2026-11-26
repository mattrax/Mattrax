import { Cause } from "effect";
import * as SqlError from "effect/sql/SqlError";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import { describe, expect, it } from "vitest";
import { isUniqueViolationForConstraint } from "@mattrax/enterprise-core";

const constraint = "tenant_deletion_organization_unique";

const duplicate = () =>
  new EffectDrizzleQueryError({
    query: "insert into tenant_deletion (id, organization_id) values (?, ?)",
    params: undefined,
    cause: new SqlError.SqlError({
      reason: new SqlError.UniqueViolation({
        cause: Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY", errno: 1062 }),
        constraint,
        operation: "insert",
      }),
    }),
  });

describe("isUniqueViolationForConstraint", () => {
  it("finds a Drizzle-wrapped unique violation inside an Effect cause", () => {
    expect(isUniqueViolationForConstraint(Cause.fail(duplicate()), constraint)).toBe(true);
  });

  it("follows nested error causes", () => {
    const wrapped = new Error("outer wrapper", { cause: duplicate() });

    expect(isUniqueViolationForConstraint(wrapped, constraint)).toBe(true);
  });

  it("rejects another constraint even when the query names the expected table", () => {
    const wrongConstraint = new EffectDrizzleQueryError({
      query: "insert into tenant_deletion (id, organization_id) values (?, ?)",
      params: undefined,
      cause: new SqlError.SqlError({
        reason: new SqlError.UniqueViolation({
          cause: new Error("Duplicate entry"),
          constraint: "tenant_deletion.PRIMARY",
        }),
      }),
    });

    expect(isUniqueViolationForConstraint(Cause.fail(wrongConstraint), constraint)).toBe(false);
  });

  it("does not fall back to driver codes or query text", () => {
    const unstructured = Object.assign(new Error("Failed query: insert into tenant_deletion"), {
      code: "ER_DUP_ENTRY",
      errno: 1062,
    });

    expect(isUniqueViolationForConstraint(unstructured, constraint)).toBe(false);
  });

  it("terminates when error causes form a cycle", () => {
    const first = new Error("first");
    const second = new Error("second", { cause: first });
    first.cause = second;

    expect(isUniqueViolationForConstraint(first, constraint)).toBe(false);
  });
});
