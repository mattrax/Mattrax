import { getRequestEvent, isServer } from "@solidjs/web";
import { Option, Schema } from "effect";

/**
 * The sign-up nonce is minted by the server on the HTML request (the web
 * Worker), stored in a cookie the API reads, and rendered into the hidden
 * Email Verification API input. Keeping the value in a request-scoped store
 * means the server render and the hydration payload carry exactly the nonce
 * the browser was given; no extra round trip and no race with a fetch.
 */
const nonces = new WeakMap<Request, string>();

export const setRegistrationNonce = (request: Request, nonce: string): void => {
  nonces.set(request, nonce);
};

export const getRegistrationNonce = (request: Request): string | undefined => nonces.get(request);

/**
 * The nonce the server serialised into this document. Read on the client so
 * the first render after hydration keeps the same attribute the server wrote.
 */
const ClientNonce = Schema.Struct({
  __MATTRAX_REGISTRATION_NONCE__: Schema.optional(Schema.String),
});

/** Keep the document's copy current when a token attempt rotates the nonce. */
export const rememberRegistrationNonce = (nonce: string): void => {
  if (typeof window === "undefined") return;

  (globalThis as { __MATTRAX_REGISTRATION_NONCE__?: string }).__MATTRAX_REGISTRATION_NONCE__ =
    nonce;
};

export const clientRegistrationNonce = (): string | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(ClientNonce)(globalThis))
    ?.__MATTRAX_REGISTRATION_NONCE__;

/** The nonce for this render, from the request on the server or the document on the client. */
export const readRegistrationNonce = (): string | undefined => {
  if (isServer) {
    const event = getRequestEvent();

    return event ? nonces.get(event.request) : undefined;
  }

  return clientRegistrationNonce();
};
