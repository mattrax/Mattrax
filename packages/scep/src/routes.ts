import { ByteSize, Effect, Layer } from "effect";
import type { HttpServerRequest } from "effect/http";
import {
  HttpServerError,
  HttpServerRequest as HttpServerRequestModule,
  HttpServerResponse,
  HttpRouter,
} from "effect/http";
import { ScepServiceTag } from "./service.js";
import type { ScepCaScope } from "./repository.js";
import { ScepError } from "./schema.js";

const SCEP_PREFIX = "/mdm/apple/scep";

/** SCEP CMS messages are bounded at 1 MiB before PKCS#7 parsing. */
export const SCEP_MAX_BODY_SIZE = ByteSize.mebibytes(1);

// Tenant ids are opaque short strings (Mattrax uses lowercase hex); keep the
// accepted set narrow so a URL cannot smuggle separators or wildcards.
const ORGANIZATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;

/**
 * SCEP is tenant-scoped: `<origin>/mdm/apple/scep/<organizationId>`.
 *
 * A path segment is used (rather than a query parameter) because SCEP clients
 * append their own `?operation=...` to the configured URL. There is deliberately
 * no deployment-wide endpoint: a request can never pick another tenant's CA.
 */
const parseScope = (pathname: string): ScepCaScope | null => {
  if (!pathname.startsWith(`${SCEP_PREFIX}/`)) return null;

  const segment = pathname.slice(SCEP_PREFIX.length + 1);

  if (segment.includes("/")) return null;

  let organizationId: string;

  try {
    organizationId = decodeURIComponent(segment);
  } catch {
    return null;
  }

  return ORGANIZATION_ID_PATTERN.test(organizationId) ? { organizationId } : null;
};

const legacyResponse = () =>
  HttpServerResponse.text(
    "This SCEP endpoint is tenant-scoped. Install the enrollment profile from the tenant's enrollment page, or use /mdm/apple/scep/<organizationId>.",
    { status: 410 },
  );

const isLegacyPath = (pathname: string) =>
  pathname === SCEP_PREFIX || pathname === `${SCEP_PREFIX}/`;

const scepErrorStatus = (error: ScepError): number => {
  if (error.reason === "unknown_tenant") return 404;

  if (error.reason === "invalid_request") return 400;

  if (error.reason === "body_too_large") return 413;

  return 500;
};

const getHandler = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const url = new URL(request.url, "http://localhost");

    if (isLegacyPath(url.pathname)) return legacyResponse();

    const scope = parseScope(url.pathname);

    if (!scope) return HttpServerResponse.text("Invalid SCEP path", { status: 400 });

    const scep = yield* ScepServiceTag;
    const operation = url.searchParams.get("operation") ?? "";

    switch (operation) {
      case "GetCACaps": {
        const caps = yield* scep.getCaCaps();

        return HttpServerResponse.text(caps, {
          contentType: "text/plain",
        });
      }

      case "GetCACert": {
        const cert = yield* scep.getCaCert(scope);

        return HttpServerResponse.uint8Array(new Uint8Array(cert.raw), {
          contentType: cert.isPkcs7
            ? "application/x-x509-ca-ra-cert"
            : "application/x-x509-ca-cert",
        });
      }

      default: {
        return HttpServerResponse.text("Invalid SCEP operation", { status: 400 });
      }
    }
  }).pipe(
    Effect.match({
      onSuccess: (val) => val,
      onFailure: (err) => {
        if (err.reason === "internal" || err.reason === "body_read_failed")
          console.error("SCEP infrastructure failure:", err);

        return HttpServerResponse.text("Error", { status: scepErrorStatus(err) });
      },
    }),
  );

const postHandler = (
  request: HttpServerRequest.HttpServerRequest,
  maxBodySize: ByteSize.ByteSize,
) =>
  Effect.gen(function* () {
    const url = new URL(request.url, "http://localhost");

    if (isLegacyPath(url.pathname)) return legacyResponse();

    const scope = parseScope(url.pathname);

    if (!scope) return HttpServerResponse.text("Invalid SCEP path", { status: 400 });

    const scep = yield* ScepServiceTag;

    const message = yield* request.arrayBuffer.pipe(
      Effect.provideService(HttpServerRequestModule.MaxBodySize, maxBodySize),
      Effect.mapError(
        (cause) =>
          new ScepError({
            message: "Failed to read the SCEP request body",
            reason:
              HttpServerError.isHttpServerError(cause) &&
              cause.reason._tag === "RequestParseError" &&
              cause.reason.reason === "BodyTooLarge"
                ? "body_too_large"
                : "body_read_failed",
            cause,
          }),
      ),
    );

    const response = yield* scep.pkiOperation(scope, message);

    return HttpServerResponse.uint8Array(new Uint8Array(response), {
      contentType: "application/x-pki-message",
    });
  }).pipe(
    Effect.match({
      onSuccess: (val) => val,
      onFailure: (err) => {
        if (err.reason === "internal" || err.reason === "body_read_failed")
          console.error("SCEP infrastructure failure:", err);

        // PKIOperation failures are client/protocol errors (malformed CMS,
        // unsupported message type, bad nonce), not server faults.
        return HttpServerResponse.text("Invalid SCEP request", { status: scepErrorStatus(err) });
      },
    }),
  );

export const scepRoutesWith = (maxBodySize = SCEP_MAX_BODY_SIZE) =>
  Layer.mergeAll(
    HttpRouter.add("GET", SCEP_PREFIX, getHandler),
    HttpRouter.add("GET", `${SCEP_PREFIX}/:organizationId`, getHandler),
    HttpRouter.add("POST", SCEP_PREFIX, (request) => postHandler(request, maxBodySize)),
    HttpRouter.add("POST", `${SCEP_PREFIX}/:organizationId`, (request) =>
      postHandler(request, maxBodySize),
    ),
  );

export const scepRoutes = scepRoutesWith();
