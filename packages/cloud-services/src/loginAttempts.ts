import { Effect, Option } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Db } from "@mattrax/enterprise-core";
import { isObservedSignInPath, recordObservedLoginAttempt } from "@mattrax/enterprise-backend";
import { normalisePath } from "./rateLimit.js";

/**
 * Observe the shared auth library's sign-in actions.
 *
 * The library owns session creation and its lifecycle hooks only run after a
 * committed success, with no request context and no failure event. Its HTTP
 * surface is the one place that sees both outcomes and the request that
 * produced them, so this global middleware reads the small JSON envelope the
 * action returned and writes one row when it names a completed session or a
 * rejection.
 *
 * It never changes the response. A missing database service or a failed write
 * only loses the log entry.
 */
export const loginAttemptObserver = HttpRouter.middleware(
  (handler) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      // Match the same normalised form the rate limiter and router use:
      // `/API/V1//completePasskeySignIn/` is a sign-in completion too.
      const path = normalisePath(new URL(request.url, "http://localhost").pathname);

      const response = yield* handler;

      if (!isObservedSignInPath(path)) return response;

      const db = yield* Effect.serviceOption(Db);

      if (Option.isNone(db)) return response;

      const body = yield* Effect.promise(async () => {
        try {
          // The action envelope is small JSON. Cloning tees the body so the
          // caller still receives the original response untouched.
          return await HttpServerResponse.toWeb(response).clone().text();
        } catch {
          return null;
        }
      });

      // The write is bookkeeping: start it detached and uninterruptible so a
      // slow or unavailable database never delays the response, and losing the
      // row never fails the sign-in.
      yield* recordObservedLoginAttempt(db.value, {
        path,
        headers: request.headers,
        remoteAddress: Option.getOrUndefined(request.remoteAddress) ?? null,
        body,
      }).pipe(Effect.forkDetach({ uninterruptible: true }));

      return response;
    }),
  { global: true },
);
