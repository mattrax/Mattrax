import { Option, Schema } from "effect";

/**
 * The deployment id travels on every HTML response as a header and as a meta
 * tag, and from `GET /version` for clients that outlive the response they were
 * rendered from. Keeping the names here (rather than in `deployment.ts`) means
 * browser-side code can read the contract without importing the build-time
 * constant.
 */
export const DEPLOYMENT_HEADER = "x-mattrax-build";

export const DEPLOYMENT_META_NAME = "mattrax-build";

/** The shape of `GET /version`; a malformed body is ignored rather than trusted. */
const VersionPayload = Schema.Struct({ build: Schema.String });

/**
 * Read a deployment id from a response header first, then its decoded body.
 * The header wins because it is available before the body is consumed and is
 * what a future proxy can attach without changing the payload.
 */
export function deploymentIdFromResponse(
  body: string | undefined,
  header: string | null,
): string | undefined {
  const fromHeader = header?.trim();

  if (fromHeader) return fromHeader;

  if (!body) return undefined;

  const parsed: unknown = (() => {
    try {
      return JSON.parse(body);
    } catch {
      return undefined;
    }
  })();

  const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(VersionPayload)(parsed));

  return decoded?.build.trim() || undefined;
}
