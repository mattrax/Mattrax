import { Cause, Predicate } from "effect";
import * as SqlError from "effect/sql/SqlError";

/**
 * Drizzle wraps driver failures in EffectDrizzleQueryError, whose message is
 * the SQL text and whose cause is the structured SqlError. Follow both error
 * causes and Effect causes without inspecting query text, so unrelated
 * failures cannot be mistaken for a duplicate key.
 */
export const isUniqueViolationForConstraint = (cause: unknown, constraint: string): boolean => {
  const visited = new Set<object>();

  const visit = (value: unknown): boolean => {
    if (!Predicate.isObject(value) || visited.has(value)) return false;

    visited.add(value);

    if (SqlError.isSqlError(value)) {
      return value.reason._tag === "UniqueViolation" && value.reason.constraint === constraint;
    }

    if (Cause.isCause(value)) {
      return value.reasons.some((reason) => {
        if (Cause.isFailReason(reason)) return visit(reason.error);
        if (Cause.isDieReason(reason)) return visit(reason.defect);

        return false;
      });
    }

    return Predicate.hasProperty(value, "cause") && visit(value.cause);
  };

  return visit(cause);
};
