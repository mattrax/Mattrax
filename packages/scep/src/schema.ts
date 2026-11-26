import { Data } from "effect";

export class ScepError extends Data.TaggedError("ScepError")<{
  message: string;
  cause?: unknown;
  /**
   * Machine-readable classification for the HTTP layer. A tenant-scoped SCEP
   * URL that names an unknown organization must return 404 rather than
   * bootstrapping (or leaking the difference between "no tenant" and "no CA").
   */
  reason?:
    | "unknown_tenant"
    | "invalid_request"
    | "body_too_large"
    | "body_read_failed"
    | "internal";
}> {}
