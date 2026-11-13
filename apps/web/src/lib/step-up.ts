import { errorField, errorMessage, errorTag } from "~/lib/errors";
import {
  requestStepUp,
  stepUpGrant,
  type StepUpAction,
  type StepUpMethod,
} from "~/lib/step-up-bus";

type StepUpGrant = { grant: string; expiresAtMillis: number; method: StepUpMethod };

type ApiFailure = { _tag?: string; message?: string; action?: string; methods?: string[] };

const stepUpPath = (path: string) => `/api/v1/account/step-up${path}`;

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(stepUpPath(path), {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "x-effect-auth-csrf": "1",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const data = (await response.json().catch(() => undefined)) as
    | (T & { _tag?: string; error?: ApiFailure })
    | undefined;

  if (!response.ok || data?._tag === "Failure") {
    const failure = data?.error ?? (data as ApiFailure | undefined);

    const error = new Error(
      errorMessage(
        { _tag: failure?._tag, message: failure?.message },
        "We couldn't confirm that action. Try again.",
      ),
    ) as Error & { _tag?: string; action?: string; methods?: string[] };

    if (failure?._tag) error._tag = failure._tag;

    if (failure?.action) error.action = failure.action;

    if (failure?.methods) error.methods = failure.methods;
    throw error;
  }

  return data as T;
}

export const stepUpMethods = () => call<{ password: boolean; totp: boolean; passkey: boolean }>("");

/**
 * Run the interactive part of a step-up. The caller (the dialog) already knows
 * which factors the account has; this only performs the ceremony and returns a
 * grant, which is bound to the session and the action.
 */
export const performStepUp = async (
  action: StepUpAction,
  method: StepUpMethod,
  input: { password?: string; code?: string },
): Promise<StepUpGrant> => {
  if (method === "password")
    return call<StepUpGrant>("/password", { password: input.password ?? "", action });

  if (method === "totp") return call<StepUpGrant>("/totp", { code: input.code ?? "", action });

  const started = await call<{
    stepUpToken: string;
    expiresAtMillis: number;
    options: unknown;
  }>("/passkey/begin", { action });

  let response: unknown;

  try {
    const { startAuthentication } = await import("@simplewebauthn/browser");
    response = await startAuthentication({
      optionsJSON: started.options as never,
      useBrowserAutofill: false,
    });
  } catch {
    throw new Error("That passkey wasn't confirmed. Try again or use another method.");
  }

  return call<StepUpGrant>("/passkey/complete", {
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
  let methods: StepUpMethod[] | undefined;

  try {
    const available = await call<{ password: boolean; totp: boolean; passkey: boolean }>("");
    methods = (Object.entries(available) as Array<[StepUpMethod, boolean]>)
      .filter(([, enabled]) => enabled)
      .map(([method]) => method);
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
    if (errorTag(error) !== "StepUpRequired") throw error;
    const required = (errorField(error, "action") as StepUpAction | undefined) ?? action;
    const methods = errorField(error, "methods");

    const grant = await requestStepUp(
      required,
      Array.isArray(methods) ? (methods as StepUpMethod[]) : undefined,
    );

    return run(grant);
  }
};
