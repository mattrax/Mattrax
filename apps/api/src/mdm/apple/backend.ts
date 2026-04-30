import { Effect, Schema } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { HttpServerResponse } from "effect/unstable/http";
import { AppleMdmService } from "./service";
import { ScepService } from "./scep/service";
import { AppleMdmRepository } from "./repository";
import { parsePlist, serializePlist } from "./plist";
import {
  AuthenticatePlist,
  TokenUpdatePlist,
  CheckOutPlist,
  CommandResultPlist,
  DDMStatusReport,
  DeviceNotFound,
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
    .handle("scepGet", ({ request }) =>
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
            return HttpServerResponse.uint8Array(new Uint8Array(cert), {
              contentType: "application/x-x509-ca-cert",
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
    )
    .handle("scepPost", ({ payload }) =>
      Effect.gen(function* () {
        const scep = yield* ScepService;
        const message = new Uint8Array(payload);
        const messageType = detectScepMessageType(message);

        switch (messageType) {
          case "PKIOperation": {
            const response = yield* scep.pkiOperation(message.buffer as ArrayBuffer);
            return HttpServerResponse.uint8Array(new Uint8Array(response), {
              contentType: "application/x-pki-message",
            });
          }
          default: {
            return HttpServerResponse.text("Invalid message type", { status: 400 });
          }
        }
      }).pipe(
        Effect.match({
          onSuccess: (val) => val,
          onFailure: (err) => {
            console.error("scepPost error:", err);
            return HttpServerResponse.text("Error", { status: 500 });
          },
        }),
      ),
    )
    .handle("mdm", ({ payload }) =>
      Effect.gen(function* () {
        const service = yield* AppleMdmService;
        const text = new TextDecoder().decode(payload);
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
              return new Uint8Array(0);
            }
            case "TokenUpdate": {
              const update = yield* Schema.decodeUnknownEffect(TokenUpdatePlist)(plist).pipe(
                Effect.mapError((err) => new Error(String(err))),
              );
              yield* service.handleTokenUpdate(update);
              return new Uint8Array(0);
            }
            case "CheckOut": {
              const checkout = yield* Schema.decodeUnknownEffect(CheckOutPlist)(plist).pipe(
                Effect.mapError((err) => new Error(String(err))),
              );
              yield* service.handleCheckOut(checkout);
              return new Uint8Array(0);
            }
            case "DeclarativeManagement": {
              const endpoint = (plist as any).Endpoint;
              const udid = (plist as any).UDID;
              const repo = yield* AppleMdmRepository;
              const device = yield* repo.getDeviceByUdid(udid);
              if (!device) return new Uint8Array(0);

              switch (endpoint) {
                case "tokens": {
                  const tokens = yield* service.handleDeclarativeTokens(device.id);
                  const response = yield* serializePlist(tokens);
                  return new TextEncoder().encode(response);
                }
                case "declaration-items": {
                  const items = yield* service.handleDeclarationItems(device.id);
                  const response = yield* serializePlist(items);
                  return new TextEncoder().encode(response);
                }
                case "status": {
                  const report = (plist as any).Data;
                  const decoded = yield* Schema.decodeUnknownEffect(DDMStatusReport)(report).pipe(
                    Effect.mapError((err) => new Error(String(err))),
                  );
                  yield* service.handleStatusReport(device.id, decoded);
                  return new Uint8Array(0);
                }
                default: {
                  if (typeof endpoint === "string" && endpoint.startsWith("declaration/")) {
                    const parts = endpoint.split("/");
                    const type = parts[1] ?? "";
                    const identifier = parts[2] ?? "";
                    const decl = yield* service.handleDeclaration(device.id, type, identifier);
                    const response = yield* serializePlist(decl);
                    return new TextEncoder().encode(response);
                  }
                  return new Uint8Array(0);
                }
              }
            }
            default:
              return new Uint8Array(0);
          }
        } else if (status !== undefined) {
          const result = yield* Schema.decodeUnknownEffect(CommandResultPlist)(plist).pipe(
            Effect.mapError((err) => new Error(String(err))),
          );
          yield* service.handleCommandResult(result);
          return new Uint8Array(0);
        } else {
          const udid = (plist as any)?.UDID;
          if (!udid) return new Uint8Array(0);

          const repo = yield* AppleMdmRepository;
          const device = yield* repo.getDeviceByUdid(udid);
          if (!device) return new Uint8Array(0);

          const command = yield* service.retrieveNextCommand(device.id);
          if (!command) {
            const empty = yield* serializePlist({});
            return new TextEncoder().encode(empty);
          }

          yield* repo.updateCommandStatus(command.id, "sent");

          const commandPlist = {
            CommandUUID: command.id,
            Command: {
              RequestType: command.requestType,
              ...(command.payload as object),
            },
          };
          const response = yield* serializePlist(commandPlist);
          return new TextEncoder().encode(response);
        }
      }).pipe(
        Effect.match({
          onSuccess: (val) => val,
          onFailure: (err) => {
            console.error("mdm error:", err);
            return new Uint8Array(0);
          },
        }),
      ),
    )
    .handle("listDevices", () =>
      Effect.gen(function* () {
        return [];
      }),
    )
    .handle("getDevice", ({ payload }) =>
      Effect.gen(function* () {
        const repo = yield* AppleMdmRepository;
        const device = yield* repo.getDeviceById(payload.id);
        if (!device) return yield* new DeviceNotFound({ deviceId: payload.id });
        return device;
      }).pipe(
        Effect.match({
          onSuccess: (val) => val,
          onFailure: (err) => {
            console.error("getDevice error:", err);
            return {} as any;
          },
        }),
      ),
    )
    .handle("syncDevice", ({ payload }) =>
      Effect.gen(function* () {
        const service = yield* AppleMdmService;
        yield* service.reconcileDevice(payload.id);
        return "ok";
      }).pipe(
        Effect.match({
          onSuccess: (val) => val,
          onFailure: (err) => {
            console.error("syncDevice error:", err);
            return "error";
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
    .handle("createDeclaration", ({ payload }) =>
      Effect.gen(function* () {
        const service = yield* AppleMdmService;
        yield* service.createDeclaration(payload);
        return "ok";
      }).pipe(
        Effect.match({
          onSuccess: (val) => val,
          onFailure: (err) => {
            console.error("createDeclaration error:", err);
            return "error";
          },
        }),
      ),
    )
    .handle("listDeclarations", () =>
      Effect.gen(function* () {
        const repo = yield* AppleMdmRepository;
        return yield* repo.getDeclarations();
      }).pipe(
        Effect.match({
          onSuccess: (val) => val,
          onFailure: (err) => {
            console.error("listDeclarations error:", err);
            return [];
          },
        }),
      ),
    )
    .handle("deleteDeclaration", ({ payload }) =>
      Effect.gen(function* () {
        const service = yield* AppleMdmService;
        yield* service.deleteDeclaration(payload.id);
        return "ok";
      }).pipe(
        Effect.match({
          onSuccess: (val) => val,
          onFailure: (err) => {
            console.error("deleteDeclaration error:", err);
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

function detectScepMessageType(message: Uint8Array): "GetCACaps" | "GetCACert" | "PKIOperation" | "Unknown" {
  if (message.length > 0 && message[0] === 0x30) {
    return "PKIOperation";
  }
  const text = new TextDecoder().decode(message).trim().toLowerCase();
  if (text.includes("getcacaps")) return "GetCACaps";
  if (text.includes("getcacert")) return "GetCACert";
  if (text.includes("pkcsreq") || text.includes("pkioperation")) return "PKIOperation";
  try {
    const decoded = atob(text);
    if (decoded.charCodeAt(0) === 0x30) return "PKIOperation";
  } catch {
    // ignore
  }
  return "Unknown";
}
