import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { StepUpMethods, StepUpRequired } from "@mattrax/enterprise-domain/client";
import { Effect, Option, Schema } from "effect";
import { HttpBody, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { webHttpClientLayer } from "~/lib/web-http";
import { errorPresentation, errorTag, raisedFailure, stepUpFailure } from "~/lib/errors";
import {
  requestStepUp,
  stepUpGrant,
  STEP_UP_METHODS,
  StepUpActionSchema,
  StepUpMethodSchema,
} from "~/lib/step-up-bus";
import type { StepUpAction, StepUpMethod } from "~/lib/step-up-bus";

const StepUpGrant = Schema.Struct({
  grant: Schema.String,
  expiresAtMillis: Schema.Number,
  method: StepUpMethodSchema,
});

type StepUpGrant = typeof StepUpGrant.Type;

const PasskeyStarted = Schema.Struct({
  stepUpToken: Schema.String,
  expiresAtMillis: Schema.Number,
  options: Schema.Unknown,
});

const FailureEnvelope = Schema.Struct({
  _tag: Schema.Literal("Failure"),
  message: Schema.optional(Schema.String),
  error: Schema.optional(Schema.Unknown),
});

const isFailureEnvelope = Schema.is(FailureEnvelope);

const decodeAction = Schema.decodeUnknownOption(StepUpActionSchema);

const decodeMethods = Schema.decodeUnknownOption(Schema.Array(StepUpMethodSchema));

const stepUpPath = (path: string) => `/api/v1/account/step-up${path}`;

const call = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  path: string,
  body?: Schema.Json,
): Promise<S["Type"]> => {
  const headers = {
    "x-effect-auth-csrf": "1",
    ...(body === undefined ? {} : { "content-type": "application/json" }),
  };

  const effect: Effect.Effect<S["Type"], Error | StepUpRequired, HttpClient.HttpClient> =
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client
        .execute(
          HttpClientRequest.make(body === undefined ? "GET" : "POST")(stepUpPath(path), {
            headers,
            ...(body === undefined ? {} : { body: HttpBody.jsonUnsafe(body) }),
          }),
        )
        .pipe(
          Effect.catch(() => Effect.fail(new Error("The step-up service could not be reached"))),
        );
      const raw = yield* HttpClientResponse.schemaBodyJson(Schema.Json)(response).pipe(
        Effect.catch(() => Effect.succeed(null)),
      );
      const failed = isFailureEnvelope(raw);

      if (response.status < 200 || response.status >= 300 || failed) {
        const failure = failed ? raw.error : raw;
        const failureValue = raisedFailure(failure);
        const action = Option.getOrUndefined(decodeAction(stepUpFailure(failureValue).action));
        const methods = Option.getOrUndefined(decodeMethods(stepUpFailure(failureValue).methods));
        const message = errorPresentation(
          failureValue,
          "We couldn't confirm that action. Try again.",
        ).message;

        if (errorTag(failureValue) === "StepUpRequired" && action !== undefined)
          return yield* Effect.fail(
            new StepUpRequired({ message, action, methods: methods ?? [] }),
          );

        return yield* Effect.fail(new Error(message));
      }

      return yield* Schema.decodeUnknownEffect(schema)(raw).pipe(
        Effect.catch(() =>
          Effect.fail(new Error("The step-up service returned an unexpected response. Try again.")),
        ),
      );
    });

  return Effect.runPromise(effect.pipe(Effect.provide(webHttpClientLayer)));
};

export const stepUpMethods = () => call(StepUpMethods, "");

/**
 * Run the interactive part of a step-up. The caller (the dialog) already knows
 * which factors the account has; this only performs the ceremony and returns a
 * grant, which is bound to the session and the action.
 */
export const performStepUp = async (
  action: StepUpAction,
  method: StepUpMethod,
  input: { code?: string },
): Promise<StepUpGrant> => {
  if (method === "totp") return call(StepUpGrant, "/totp", { code: input.code ?? "", action });

  const started = await call(PasskeyStarted, "/passkey/begin", { action });
  let response: unknown;

  try {
    const { startAuthentication } = await import("@simplewebauthn/browser");
    response = await startAuthentication({
      // SAFETY: the step-up endpoint builds these options with
      // @simplewebauthn/server's generateAuthenticationOptions, so they match
      // the browser helper's request shape.
      optionsJSON: started.options as PublicKeyCredentialRequestOptionsJSON,
      useBrowserAutofill: false,
    });
  } catch {
    throw new Error("That passkey wasn't confirmed. Try again or use another method.");
  }

  return call(StepUpGrant, "/passkey/complete", {
    stepUpToken: started.stepUpToken,
    response: JSON.stringify(response),
  });
};

/**
 * Return a cached grant for `action`, or prompt for one with the factors the
 * account actually has. Used by flows that carry the grant as an action proof
 * rather than as a request header.
 */
export const requireStepUpGrant = async (action: StepUpAction): Promise<string> => {
  const cached = stepUpGrant(action);

  if (cached) return cached;

  let methods: ReadonlyArray<StepUpMethod> | undefined;

  try {
    const available = await call(StepUpMethods, "");
    methods = STEP_UP_METHODS.filter((method) => available[method]);
  } catch {
    // Fall back to offering every method; the dialog reports a rejection.
  }

  return requestStepUp(action, methods);
};

/**
 * Retry a request that failed with `StepUpRequired` after the user confirms a
 * factor. Non-step-up failures pass through unchanged.
 */
export const withStepUp = async <T>(
  action: StepUpAction,
  run: (grant: string | undefined) => Promise<T>,
): Promise<T> => {
  try {
    return await run(stepUpGrant(action));
  } catch (error) {
    const failure = raisedFailure(error);

    if (errorTag(failure) !== "StepUpRequired") throw error;

    const fields = stepUpFailure(failure);
    const required = Option.getOrUndefined(decodeAction(fields.action)) ?? action;
    const methods = Option.getOrUndefined(decodeMethods(fields.methods));

    return run(await requestStepUp(required, methods));
  }
};
