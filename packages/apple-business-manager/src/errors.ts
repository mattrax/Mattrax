import { Data } from "effect";

/**
 * Failure types for the Apple Business Manager and Apps and Books clients.
 *
 * They live in their own module so a boundary that reports an unavailable
 * client (for example the API's lazy accessors) can construct the same typed
 * error without importing the clients themselves.
 */

export type AppleBusinessManagerErrorKind =
  | "not_configured"
  | "invalid_token"
  | "expired"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid_response"
  | "upstream";

export class AppleBusinessManagerError extends Data.TaggedError("AppleBusinessManagerError")<{
  message: string;
  kind: AppleBusinessManagerErrorKind;
  cause?: unknown;
}> {}

export type VppErrorKind =
  | "not_configured"
  | "invalid_token"
  | "expired"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "no_license"
  | "invalid_response"
  | "upstream";

export class VppError extends Data.TaggedError("VppError")<{
  message: string;
  kind: VppErrorKind;
  cause?: unknown;
}> {}
