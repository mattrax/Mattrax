import { Effect } from "effect";

/** Preserve failure isolation without hiding the tenant or root cause. */
export const logBestEffortFailure = <A, E, R>(
  operation: string,
  tenantId: string,
): ((effect: Effect.Effect<A, E, R>) => Effect.Effect<A | void, never, R>) =>
  Effect.catch((error) =>
    Effect.logWarning("Best-effort delivery failed", {
      tenantId,
      operation,
      cause: error,
    }),
  );
