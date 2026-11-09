import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { WindowsMdmService } from "./service.js";

function textRequest(request: HttpServerRequest.HttpServerRequest) {
  return request.arrayBuffer.pipe(Effect.map((buf) => new TextDecoder().decode(buf)));
}

function soapHandler(
  handle: (service: WindowsMdmService.Service, body: string) => Effect.Effect<string, unknown>,
) {
  return (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const service = yield* WindowsMdmService;
      const body = yield* textRequest(request);
      const response = yield* handle(service, body).pipe(
        Effect.match({
          onFailure: (err) => Effect.runSync(service.fault(String((err as any)?.message ?? err))),
          onSuccess: (value) => value,
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
    const identityCertificate = request.headers["x-device-identity-certificate"] as
      | string
      | undefined;
    const response = yield* service.management(body, identityCertificate).pipe(
      Effect.match({
        onFailure: (err) => Effect.runSync(service.fault(String((err as any)?.message ?? err))),
        onSuccess: (value) => value,
      }),
    );
    return HttpServerResponse.text(response, { contentType: "application/vnd.syncml.dm+xml" });
  });
}

export const windowsMdmRoutes = Layer.mergeAll(
  HttpRouter.add(
    "POST",
    "/mdm/windows/discovery",
    soapHandler((service, body) => service.discovery(body)),
  ),
  HttpRouter.add(
    "POST",
    "/mdm/windows/policy",
    soapHandler((service, body) => service.policy(body)),
  ),
  HttpRouter.add(
    "POST",
    "/mdm/windows/enroll",
    soapHandler((service, body) => service.enroll(body)),
  ),
  HttpRouter.add("POST", "/mdm/windows/management", managementHandler),
);
