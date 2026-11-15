import { MeResponse } from "@mattrax/enterprise-domain/client";
import { Option, Schema } from "effect";

/**
 * The session the server already loaded for a page request.
 *
 * `me` carries the account/tenant shell so SSR and the query cache can paint
 * permission-aware navigation on the first frame without a binding call. It is
 * the same personal payload `/api/v1/me` returns, serialised into the private,
 * no-store HTML shell — never shared or cached across requests.
 */
export const PreloadedSession = Schema.Struct({
  sessionId: Schema.String,
  subjectId: Schema.String,
  claims: Schema.Struct({
    name: Schema.String,
    email: Schema.String,
    emailVerified: Schema.Boolean,
  }),
  me: Schema.optional(MeResponse),
});

export type PreloadedSessionData = typeof PreloadedSession.Type;

export type PreloadedSession = PreloadedSessionData | null;

const sessions = new WeakMap<Request, PreloadedSession>();

export function setPreloadedSession(request: Request, session: PreloadedSession): void {
  sessions.set(request, session);
}

export function getPreloadedSession(request: Request): PreloadedSession | undefined {
  return sessions.get(request);
}

/** The shell payload the SSR document serialised for the browser. */
const ClientSessionGlobal = Schema.Struct({
  __MATTRAX_SESSION__: Schema.optional(Schema.NullOr(PreloadedSession)),
});

/**
 * Read the browser-side preloaded `me` (hydrated from
 * `window.__MATTRAX_SESSION__`) so a client-side query can seed from it too.
 */
export function readClientPreloadedMe(): MeResponse | undefined {
  const stored = Option.getOrUndefined(
    Schema.decodeUnknownOption(ClientSessionGlobal)(globalThis),
  );

  return stored?.__MATTRAX_SESSION__?.me ?? undefined;
}
