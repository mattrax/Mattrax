import { Effect, Layer, Schema } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { HttpServerResponse, HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { AppleMdmService } from "./service.js";
import { parsePlist, serializePlist } from "@mattrax/plist";
import {
  AuthenticatePlist,
  TokenUpdatePlist,
  CheckOutPlist,
  CommandResultPlist,
  DDMStatusReport,
} from "./schema.js";
import { appleMdmApi } from "./domain.js";
import type { CheckinScope } from "@mattrax/management-backend";

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

    const identityCertificate = request.headers["x-device-identity-certificate"] as string | undefined;

    const messageType = (plist as any)?.MessageType;
    const status = (plist as any)?.Status;

    if (messageType) {
      switch (messageType) {
        case "Authenticate": {
          const auth = yield* Schema.decodeUnknownEffect(AuthenticatePlist)(plist).pipe(
            Effect.mapError((err) => new Error(String(err))),
          );
          yield* service.handleAuthenticate(auth, identityCertificate);
          return HttpServerResponse.empty({ status: 200 });
        }
        case "TokenUpdate": {
          const update = yield* Schema.decodeUnknownEffect(TokenUpdatePlist)(plist).pipe(
            Effect.mapError((err) => new Error(String(err))),
          );
          yield* service.handleTokenUpdate(update, identityCertificate);
          return HttpServerResponse.empty({ status: 200 });
        }
        case "CheckOut": {
          const checkout = yield* Schema.decodeUnknownEffect(CheckOutPlist)(plist).pipe(
            Effect.mapError((err) => new Error(String(err))),
          );
          yield* service.handleCheckOut(checkout, identityCertificate);
          return HttpServerResponse.empty({ status: 200 });
        }
        case "DeclarativeManagement": {
          const endpoint = (plist as any).Endpoint;
          const udid = (plist as any).UDID;
          if (!udid) return HttpServerResponse.empty({ status: 200 });

          const scope: CheckinScope = { _tag: "device", udid, identityCertificate, mdmOrigin: service.mdmOrigin };

          switch (endpoint) {
            case "tokens": {
              const tokens = yield* service.handleDeclarativeTokens(scope);
              const response = yield* serializePlist(tokens);
              return HttpServerResponse.text(response, { contentType: "application/xml" });
            }
            case "declaration-items": {
              const items = yield* service.handleDeclarationItems(scope);
              const response = yield* serializePlist(items);
              return HttpServerResponse.text(response, { contentType: "application/xml" });
            }
            case "status": {
              const report = (plist as any).Data;
              const decoded = yield* Schema.decodeUnknownEffect(DDMStatusReport)(report).pipe(
                Effect.mapError((err) => new Error(String(err))),
              );
              yield* service.handleStatusReport(scope, decoded);
              return HttpServerResponse.empty({ status: 200 });
            }
            default: {
              if (typeof endpoint === "string" && endpoint.startsWith("declaration/")) {
                const parts = endpoint.split("/");
                const type = parts[1] ?? "";
                const identifier = parts[2] ?? "";
                const decl = yield* service.handleDeclaration(scope, type, identifier);
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
      yield* service.handleCommandResult(result, identityCertificate);
      return HttpServerResponse.empty({ status: 200 });
    } else {
      const udid = (plist as any)?.UDID;
      if (!udid) return HttpServerResponse.empty({ status: 200 });

      const scope: CheckinScope = { _tag: "device", udid, identityCertificate, mdmOrigin: service.mdmOrigin };
      const command = yield* service.handleCheckin(scope);
      if (!command) {
        const empty = yield* serializePlist({});
        return HttpServerResponse.text(empty, { contentType: "application/xml" });
      }

      const commandPlist = {
        CommandUUID: command.commandUUID,
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

function handleAsset(request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    const service = yield* AppleMdmService;
    const identityCertificate = request.headers["x-device-identity-certificate"] as string | undefined;
    const url = new URL(request.url, "http://localhost");
    const identifier = url.pathname.replace("/mdm/apple/assets/", "");
    if (!identifier) return HttpServerResponse.empty({ status: 404 });

    const asset = yield* service.handleAsset(identityCertificate, identifier);
    if (!asset) return HttpServerResponse.empty({ status: 404 });

    return HttpServerResponse.uint8Array(asset.content, { contentType: asset.contentType });
  }).pipe(
    Effect.match({
      onSuccess: (val) => val,
      onFailure: (err) => {
        console.error("asset error:", err);
        return HttpServerResponse.empty({ status: 500 });
      },
    }),
  );
}

export const appleMdmRoutes = Layer.mergeAll(
  HttpRouter.add("PUT", "/mdm/apple/mdm", handleMdm),
  HttpRouter.add("GET", "/mdm/apple/assets/:identifier", handleAsset),
);
