import { Cause, Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { WindowsMdmError, WindowsMdmService, type WindowsMdmRequestContext } from "./service.js";

function textRequest(request: HttpServerRequest.HttpServerRequest) {
  return request.arrayBuffer.pipe(Effect.map((buf) => new TextDecoder().decode(buf)));
}

/**
 * `WindowsMdmError` is deliberately a plain value object, not an `Error`, so
 * `instanceof Error` would discard every curated message. Anything else (an
 * unexpected defect) must not leak its message into the SOAP fault.
 */
function describeFailure(cause: Cause.Cause<unknown>, fallback: string) {
  try {
    const error = Cause.squash(cause);

    if (error instanceof WindowsMdmError && error.message.trim()) return error.message;
  } catch {
    // An empty/interrupted cause has nothing to describe.
  }

  return fallback;
}

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const fallbackFaultEnvelope = (message: string) =>
  `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><s:Fault><s:Code><s:Value>s:Receiver</s:Value></s:Code><s:Reason><s:Text xml:lang="en-us">${escapeXml(message)}</s:Text></s:Reason></s:Fault></s:Body></s:Envelope>`;

/** The fault encoder can itself fail (for example on a serialization defect). */
function encodeFault(service: WindowsMdmService.Service, message: string) {
  try {
    const encoded = Effect.runSync(service.fault(message));

    if (encoded.trim()) return encoded;
  } catch {
    // Fall through to a minimal, fixed envelope.
  }

  return fallbackFaultEnvelope(message);
}

/**
 * Tenant identity for Windows protocol requests comes from the enrollment URL
 * (`?tenant=<signed token>`); device identity comes from the edge-verified mTLS
 * headers, which the API Worker only sets after checking the certificate.
 */
const headerString = (value: string | string[] | undefined): string | undefined =>
  Schema.is(Schema.String)(value) ? value : undefined;

function requestContext(request: HttpServerRequest.HttpServerRequest): WindowsMdmRequestContext {
  const url = new URL(request.url, "http://localhost");
  const tenantToken = url.searchParams.get("tenant") ?? undefined;
  const identityCertificate = headerString(request.headers["x-device-identity-certificate"]);

  const identityCertificateSerial = headerString(
    request.headers["x-device-identity-certificate-serial"],
  );

  return { tenantToken, identityCertificate, identityCertificateSerial };
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
          onFailure: (cause) =>
            encodeFault(service, describeFailure(cause, "Invalid SOAP request")),
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
        onFailure: (cause) =>
          encodeFault(service, describeFailure(cause, "Invalid SyncML request")),
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
