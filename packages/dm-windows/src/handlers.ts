import { Cause, Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { WindowsMdmService, type WindowsMdmRequestContext } from "./service.js";

function textRequest(request: HttpServerRequest.HttpServerRequest) {
  return request.arrayBuffer.pipe(Effect.map((buf) => new TextDecoder().decode(buf)));
}

/**
 * Tenant identity for Windows protocol requests comes from the enrollment URL
 * (`?tenant=<signed token>`); device identity comes from the edge-verified mTLS
 * headers, which the API Worker only sets after checking the certificate.
 */
function requestContext(request: HttpServerRequest.HttpServerRequest): WindowsMdmRequestContext {
  const url = new URL(request.url, "http://localhost");
  const tenantToken = url.searchParams.get("tenant") ?? undefined;
  const identityCertificate = request.headers["x-device-identity-certificate"] as
    | string
    | undefined;
  const identityCertificateSerial = request.headers["x-device-identity-certificate-serial"] as
    | string
    | undefined;
  return {
    ...(tenantToken ? { tenantToken } : {}),
    ...(identityCertificate ? { identityCertificate } : {}),
    ...(identityCertificateSerial ? { identityCertificateSerial } : {}),
  };
}

function soapHandler(
  handle: (
    service: WindowsMdmService.Service,
    body: string,
    context: WindowsMdmRequestContext,
  ) => Effect.Effect<string, unknown>,
) {
  return (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const service = yield* WindowsMdmService;
      const body = yield* textRequest(request);
      const response = yield* handle(service, body, requestContext(request)).pipe(
        Effect.matchCause({
          onSuccess: (value) => value,
          onFailure: (cause) => {
            const error = Cause.squash(cause);
            return Effect.runSync(
              service.fault(error instanceof Error ? error.message : "Invalid SOAP request"),
            );
          },
        }),
      );
      return HttpServerResponse.text(response, {
        contentType: "application/soap+xml; charset=utf-8",
      });
    });
}

function managementHandler(request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    const service = yield* WindowsMdmService;
    const body = yield* textRequest(request);
    const response = yield* service.management(body, requestContext(request)).pipe(
      Effect.matchCause({
        onSuccess: (value) => value,
        onFailure: (cause) => {
          const error = Cause.squash(cause);
          return Effect.runSync(
            service.fault(error instanceof Error ? error.message : "Invalid SyncML request"),
          );
        },
      }),
    );
    return HttpServerResponse.text(response, { contentType: "application/vnd.syncml.dm+xml" });
  });
}

export const windowsMdmRoutes = Layer.mergeAll(
  HttpRouter.add(
    "POST",
    "/mdm/windows/discovery",
    soapHandler((service, body, context) => service.discovery(body, context)),
  ),
  HttpRouter.add(
    "POST",
    "/mdm/windows/policy",
    soapHandler((service, body, context) => service.policy(body, context)),
  ),
  HttpRouter.add(
    "POST",
    "/mdm/windows/enroll",
    soapHandler((service, body, context) => service.enroll(body, context)),
  ),
  HttpRouter.add("POST", "/mdm/windows/management", managementHandler),
);
