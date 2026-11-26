import { Cause, Effect } from "effect";

/**
 * Map a request failure without turning fiber interruption into a response.
 * Interrupts are control flow: logging or recovering them as a service failure
 * delays cancellation and can make an aborted request look like a 500.
 */
export const catchCausePreservingInterrupts =
  <A2, E2, R2>(onCause: (cause: Cause.Cause<unknown>) => Effect.Effect<A2, E2, R2>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A | A2, E2, R | R2> =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause)
          ? // The boundary rethrows the original cause, including any mixed
            // reasons. Its declared channel belongs to the response mapper.
            // oxlint-disable-next-line quality/no-chained-type-assertions -- The runtime cause is rethrown verbatim; only the boundary's declared channel narrows.
            Effect.failCause(cause as unknown as Cause.Cause<E2>)
          : onCause(cause),
      ),
    );
