import type { Schema } from "effect";
import { Effect, Match } from "effect";
import {
  EnterpriseBadRequest,
  EnterprisePreconditionFailed,
  updatedAtPrecondition,
} from "@mattrax/enterprise-domain";
import type { PreconditionCurrent, UpdatedAtPrecondition } from "@mattrax/enterprise-domain";

/** Platform or Effect `Headers`: both expose a callable `get`. */
type HeaderGetter = { readonly get: (name: string) => string | null | undefined };

/** A plain header record, which tests and some adapters provide. */
type HeaderRecord = Readonly<Record<string, string | string[] | undefined>>;

type HeaderSource = HeaderGetter | HeaderRecord;

/** The part of an HTTP request this module reads. */
export type PreconditionRequest = { readonly headers?: HeaderSource };

// Transport boundary: the platform Headers and Effect's Headers both expose a
// callable `get`.
const isHeaderGetter = (headers: HeaderSource): headers is HeaderGetter =>
  typeof headers["get"] === "function";

/**
 * Read one request header from either the platform `Headers` instance or the
 * plain record tests and some adapters provide.
 */
export const requestHeader = (request: PreconditionRequest, name: string): string | undefined => {
  const headers = request.headers;

  if (!headers) return undefined;

  if (isHeaderGetter(headers)) return headers.get(name) ?? undefined;

  // HTTP header names are case-insensitive; a plain record may use any case.
  const wanted = name.toLowerCase();
  const value = Object.entries(headers).find(([header]) => header.toLowerCase() === wanted)?.[1];

  return Array.isArray(value) ? value[0] : value;
};

/**
 * Resolve the precondition from the body's `expectedUpdatedAt` and the
 * standard `If-Unmodified-Since` header. A malformed value is a 400: the
 * caller sent something, and ignoring it would make a guarded write silently
 * unconditional.
 *
 * The header is read from the raw request rather than declared on the
 * `HttpApiEndpoint`. Declaring a headers schema makes `headers` a required
 * argument on every generated client call, including calls that omit the
 * precondition, which would break existing TypeScript consumers. The wire
 * contract still accepts the standard header.
 */
export const preconditionFromRequest = (
  request: PreconditionRequest,
  expectedUpdatedAt: string | undefined,
): Effect.Effect<UpdatedAtPrecondition, EnterpriseBadRequest> =>
  Effect.gen(function* () {
    const precondition = updatedAtPrecondition({
      expectedUpdatedAt,
      ifUnmodifiedSince: requestHeader(request, "if-unmodified-since"),
    });

    const invalid = Match.value(precondition).pipe(
      Match.tag("Invalid", (value) => value.value),
      Match.orElse(() => undefined),
    );

    if (invalid !== undefined)
      return yield* Effect.fail(
        new EnterpriseBadRequest({
          message: `expectedUpdatedAt must be an ISO-8601 timestamp or an HTTP-date (received "${invalid}").`,
        }),
      );

    return precondition;
  });

/**
 * The 412 body. `record` is the endpoint's current representation, so a
 * dashboard can show what changed without racing a second read.
 */
export const preconditionFailure = (input: {
  readonly resource: string;
  readonly precondition: UpdatedAtPrecondition;
  readonly current: { readonly id: string; readonly name: string; readonly updatedAt: Date };
  readonly record?: Schema.Json;
}): EnterprisePreconditionFailed => {
  const expected = Match.value(input.precondition).pipe(
    Match.tag("At", (value) => value.timestamp.value),
    Match.orElse(() => undefined),
  );

  const current: PreconditionCurrent = {
    id: input.current.id,
    name: input.current.name,
    updatedAt: input.current.updatedAt.toISOString(),
    record: input.record,
  };

  return new EnterprisePreconditionFailed({
    message: `This ${input.resource} changed since you loaded it. Reload the latest version and try again.`,
    expectedUpdatedAt: expected,
    current,
  });
};
