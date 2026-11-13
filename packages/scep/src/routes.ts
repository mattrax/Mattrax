import { Effect, Layer } from "effect";
import { HttpServerResponse, HttpRouter } from "effect/http";
import { ScepServiceTag } from "./service.js";

export const scepRoutes = Layer.mergeAll(
  HttpRouter.add("GET", "/mdm/apple/scep", (request) =>
    Effect.gen(function* () {
      const scep = yield* ScepServiceTag;
      const url = new URL(request.url, "http://localhost");
      const operation = url.searchParams.get("operation") ?? "";

      switch (operation) {
        case "GetCACaps": {
          const caps = yield* scep.getCaCaps();
          return HttpServerResponse.text(caps, {
            contentType: "text/plain",
          });
        }
        case "GetCACert": {
          const cert = yield* scep.getCaCert();
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
          console.error("scepGet error:", err);
          return HttpServerResponse.text("Error", { status: 500 });
        },
      }),
    ),
  ),
  HttpRouter.add("POST", "/mdm/apple/scep", (request) =>
    Effect.gen(function* () {
      const scep = yield* ScepServiceTag;
      const message = yield* request.arrayBuffer;
      const response = yield* scep.pkiOperation(message);
      return HttpServerResponse.uint8Array(new Uint8Array(response), {
        contentType: "application/x-pki-message",
      });
    }).pipe(
      Effect.match({
        onSuccess: (val) => val,
        onFailure: (err) => {
          console.error("scepPost error:", err);
          // PKIOperation failures are client/protocol errors (malformed CMS,
          // unsupported message type, bad nonce), not server faults.
          return HttpServerResponse.text("Invalid SCEP request", { status: 400 });
        },
      }),
    ),
  ),
);
