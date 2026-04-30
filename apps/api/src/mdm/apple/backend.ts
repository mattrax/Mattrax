import { Effect, Layer, Schema } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { HttpServerResponse, HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { AppleMdmService } from "./service";
import { ScepService } from "./scep/service";
import { parsePlist, serializePlist } from "./plist";
import {
  AuthenticatePlist,
  TokenUpdatePlist,
  CheckOutPlist,
  CommandResultPlist,
  DDMStatusReport,
} from "./schema";
import { appleMdmApi } from "./domain";

export const appleMdmHandlers = (handlers: HttpApiBuilder.Handlers.FromGroup<typeof appleMdmApi>) =>
  handlers
    .handle("enroll", () =>
      Effect.gen(function* () {
        const service = yield* AppleMdmService;
        const profile = yield* service.generateEnrollmentProfile();
        const plist = yield* serializePlist(JSON.parse(profile));
        return HttpServerResponse.text(plist, {
          contentType: "application/x-apple-aspen-config",
          headers: {
            "Content-Disposition": 'attachment; filename="enroll.mobileconfig"',
          },
        });
      }).pipe(
        Effect.match({
          onSuccess: (val) => val,
          onFailure: (err) => {
            console.error("enroll error:", err);
            return HttpServerResponse.text("", { status: 500 });
          },
        }),
      ),
    )
    .handle("collectDeviceInfo", ({ payload }) =>
      Effect.gen(function* () {
        const service = yield* AppleMdmService;
        yield* service.queueCollectInformation(payload.id, payload.queries as string[]);
        return "ok";
      }).pipe(
        Effect.match({
          onSuccess: (val) => val,
          onFailure: (err) => {
            console.error("collectDeviceInfo error:", err);
            return "error";
          },
        }),
      ),
    )
    .handle("queueInstallProfile", ({ payload }) =>
      Effect.gen(function* () {
        const service = yield* AppleMdmService;
        yield* service.queueInstallProfile(payload.deviceId, payload.profile);
        return "ok";
      }).pipe(
        Effect.match({
          onSuccess: (val) => val,
          onFailure: (err) => {
            console.error("queueInstallProfile error:", err);
            return "error";
          },
        }),
      ),
    )
    .handle("queueInstallApplication", ({ payload }) =>
      Effect.gen(function* () {
        const service = yield* AppleMdmService;
        yield* service.queueInstallApplication(payload.deviceId, payload.app);
        return "ok";
      }).pipe(
        Effect.match({
          onSuccess: (val) => val,
          onFailure: (err) => {
            console.error("queueInstallApplication error:", err);
            return "error";
          },
        }),
      ),
    );

// Raw MDM checkin/command handler — registered outside HttpApiBuilder so that
// Apple's "application/x-apple-aspen-mdm-checkin" / "application/x-apple-aspen-mdm"
// content types pass through without a 415 from the framework.
function handleMdm(request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    const service = yield* AppleMdmService;
    const buf = yield* request.arrayBuffer;
    const text = new TextDecoder().decode(buf);
    const plist = yield* parsePlist(text);

    const messageType = (plist as any)?.MessageType;
    const status = (plist as any)?.Status;

    if (messageType) {
      switch (messageType) {
        case "Authenticate": {
          const auth = yield* Schema.decodeUnknownEffect(AuthenticatePlist)(plist).pipe(
            Effect.mapError((err) => new Error(String(err))),
          );
          yield* service.handleAuthenticate(auth);
          return HttpServerResponse.empty({ status: 200 });
        }
        case "TokenUpdate": {
          const update = yield* Schema.decodeUnknownEffect(TokenUpdatePlist)(plist).pipe(
            Effect.mapError((err) => new Error(String(err))),
          );
          yield* service.handleTokenUpdate(update);
          return HttpServerResponse.empty({ status: 200 });
        }
        case "CheckOut": {
          const checkout = yield* Schema.decodeUnknownEffect(CheckOutPlist)(plist).pipe(
            Effect.mapError((err) => new Error(String(err))),
          );
          yield* service.handleCheckOut(checkout);
          return HttpServerResponse.empty({ status: 200 });
        }
        case "DeclarativeManagement": {
          const endpoint = (plist as any).Endpoint;
          const udid = (plist as any).UDID;
          const device = yield* service.getDeviceSessionByUdid(udid);
          if (!device) return HttpServerResponse.empty({ status: 200 });

          switch (endpoint) {
            case "tokens": {
              const tokens = yield* service.handleDeclarativeTokens(device.deviceId);
              const response = yield* serializePlist(tokens);
              return HttpServerResponse.text(response, { contentType: "application/xml" });
            }
            case "declaration-items": {
              const items = yield* service.handleDeclarationItems(device.deviceId);
              const response = yield* serializePlist(items);
              return HttpServerResponse.text(response, { contentType: "application/xml" });
            }
            case "status": {
              const report = (plist as any).Data;
              const decoded = yield* Schema.decodeUnknownEffect(DDMStatusReport)(report).pipe(
                Effect.mapError((err) => new Error(String(err))),
              );
              yield* service.handleStatusReport(device.deviceId, decoded);
              return HttpServerResponse.empty({ status: 200 });
            }
            default: {
              if (typeof endpoint === "string" && endpoint.startsWith("declaration/")) {
                const parts = endpoint.split("/");
                const type = parts[1] ?? "";
                const identifier = parts[2] ?? "";
                const decl = yield* service.handleDeclaration(device.deviceId, type, identifier);
                const response = yield* serializePlist(decl);
                return HttpServerResponse.text(response, { contentType: "application/xml" });
              }
              return HttpServerResponse.empty({ status: 200 });
            }
          }
        }
        default:
          return HttpServerResponse.empty({ status: 200 });
      }
    } else if (status !== undefined) {
      const result = yield* Schema.decodeUnknownEffect(CommandResultPlist)(plist).pipe(
        Effect.mapError((err) => new Error(String(err))),
      );
      yield* service.handleCommandResult(result);
      return HttpServerResponse.empty({ status: 200 });
    } else {
      const udid = (plist as any)?.UDID;
      if (!udid) return HttpServerResponse.empty({ status: 200 });

      const device = yield* service.getDeviceSessionByUdid(udid);
      if (!device) return HttpServerResponse.empty({ status: 200 });
      yield* service.handleAppleCheckin(device.deviceId);

      const command = device.supportsDdm && device.dcmEnabled
        ? yield* service.retrieveDcmCommand(device.deviceId)
        : yield* service.retrieveNextCommand(device.deviceId);
      if (!command) {
        const empty = yield* serializePlist({});
        return HttpServerResponse.text(empty, { contentType: "application/xml" });
      }

      if (command.requestType !== "DeclarativeManagement") {
        yield* service.markCommandSent(command.id);
      }

      const commandPlist = {
        CommandUUID: command.id,
        Command: {
          RequestType: command.requestType,
          ...(command.payload as object),
        },
      };
      const response = yield* serializePlist(commandPlist);
      return HttpServerResponse.text(response, { contentType: "application/xml" });
    }
  }).pipe(
    Effect.match({
      onSuccess: (val) => val,
      onFailure: (err) => {
        console.error("mdm error:", err);
        return HttpServerResponse.empty({ status: 200 });
      },
    }),
  );
}

export const scepRoutes = Layer.mergeAll(
  HttpRouter.add("PUT", "/mdm/apple/mdm", handleMdm),
  HttpRouter.add("GET", "/mdm/apple/scep", (request) =>
    Effect.gen(function* () {
      const scep = yield* ScepService;
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
      const scep = yield* ScepService;
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
          return HttpServerResponse.text("Error", { status: 500 });
        },
      }),
    ),
  ),
);
