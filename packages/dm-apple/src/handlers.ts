import { Effect, Layer, Schema } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { HttpServerResponse, HttpRouter, HttpServerRequest } from "effect/http";
import { AppleMdmService } from "./service.js";
import { parsePlist, serializePlist } from "@mattrax/plist";
import {
  AuthenticatePlist,
  TokenUpdatePlist,
  CheckOutPlist,
  CommandResultPlist,
  DDMStatusReport,
  GetBootstrapTokenPlist,
  SetBootstrapTokenPlist,
} from "./schema.js";
import { appleMdmApi } from "./domain.js";
import type { CheckinScope } from "@mattrax/management-backend";

const json = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

const decodeBase64 = (value: string): Uint8Array => {
  const cleaned = value.replace(/\s/g, "");
  const padded = cleaned.padEnd(cleaned.length + ((4 - (cleaned.length % 4)) % 4), "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const commandBytes = (command: { commandUUID: string; requestType: string; payload: unknown }) =>
  serializePlist({
    CommandUUID: command.commandUUID,
    Command: { RequestType: command.requestType, ...(command.payload as object) },
  });

export const appleMdmHandlers = (handlers: HttpApiBuilder.Handlers.FromGroup<typeof appleMdmApi>) =>
  handlers.handle("enroll", () =>
    // Enrollment profiles must be tenant-scoped and carry a bound SCEP
    // challenge. The product issues them through /v1/enrollment/:id; the raw
    // worker endpoint cannot safely mint an identity certificate.
    Effect.succeed(
      HttpServerResponse.text("Use the tenant enrollment link to enroll this device.", {
        status: 410,
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
    const identityCertificate = request.headers["x-device-identity-certificate"] as
      | string
      | undefined;
    yield* service.verifyDeviceSignature({
      signature: request.headers["mdm-signature"] as string | undefined,
      body: buf,
      identityCertificateSubject: identityCertificate,
      identityCertificateSerial: request.headers["x-device-identity-certificate-serial"] as
        | string
        | undefined,
      identityCertificateFingerprintSha256: request.headers[
        "x-device-identity-certificate-sha256"
      ] as string | undefined,
    });
    const text = new TextDecoder().decode(buf);
    const plist = yield* parsePlist(text);

    const messageType = (plist as any)?.MessageType;
    const status = (plist as any)?.Status;
    const udid = (plist as any)?.UDID ?? (plist as any)?.EnrollmentID;

    const scope = (): CheckinScope => ({
      _tag: "device",
      udid: udid ?? "",
      identityCertificate,
      mdmOrigin: service.mdmOrigin,
    });

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
          if (!udid) return HttpServerResponse.empty({ status: 400 });
          const checkinScope = scope();

          if (endpoint === "tokens") {
            const tokens = yield* service.handleDeclarativeTokens(checkinScope);
            return json(tokens);
          }
          if (endpoint === "declaration-items") {
            const items = yield* service.handleDeclarationItems(checkinScope);
            return json(items);
          }
          if (endpoint === "status") {
            const data = (plist as any).Data;
            if (typeof data !== "string") return HttpServerResponse.empty({ status: 400 });
            const parsed = yield* Effect.try({
              try: () => JSON.parse(new TextDecoder().decode(decodeBase64(data))) as unknown,
              catch: (cause) => new Error(`Invalid DDM status report: ${String(cause)}`),
            });
            const decoded = yield* Schema.decodeUnknownEffect(DDMStatusReport)(parsed).pipe(
              Effect.mapError((err) => new Error(String(err))),
            );
            yield* service.handleStatusReport(checkinScope, decoded);
            return HttpServerResponse.empty({ status: 200 });
          }
          if (typeof endpoint === "string" && endpoint.startsWith("declaration/")) {
            const parts = endpoint.split("/");
            if (parts.length !== 3) return HttpServerResponse.empty({ status: 400 });
            const [, type, identifier] = parts;
            if (!["activation", "configuration", "asset", "management"].includes(type!))
              return HttpServerResponse.empty({ status: 404 });
            const decl = yield* service.handleDeclaration(checkinScope, type!, identifier!);
            return json(decl);
          }
          return HttpServerResponse.empty({ status: 404 });
        }
        case "SetBootstrapToken": {
          const token = yield* Schema.decodeUnknownEffect(SetBootstrapTokenPlist)(plist).pipe(
            Effect.mapError((err) => new Error(String(err))),
          );
          yield* service.handleSetBootstrapToken(
            token.BootstrapToken ?? "",
            identityCertificate,
            token.UDID ?? token.EnrollmentID,
          );
          return HttpServerResponse.empty({ status: 200 });
        }
        case "GetBootstrapToken": {
          const request = yield* Schema.decodeUnknownEffect(GetBootstrapTokenPlist)(plist).pipe(
            Effect.mapError((err) => new Error(String(err))),
          );
          const value = yield* service.handleGetBootstrapToken(
            identityCertificate,
            request.UDID ?? request.EnrollmentID,
          );
          if (!value) return HttpServerResponse.empty({ status: 200 });
          const binary = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
          return HttpServerResponse.text(yield* serializePlist({ BootstrapToken: binary }), {
            contentType: "application/xml",
          });
        }
        case "GetToken":
          return HttpServerResponse.empty({ status: 400 });
        case "UserAuthenticate":
          return HttpServerResponse.empty({ status: 410 });
        default:
          return HttpServerResponse.empty({ status: 400 });
      }
    }

    if (status !== undefined) {
      const result = yield* Schema.decodeUnknownEffect(CommandResultPlist)(plist).pipe(
        Effect.mapError((err) => new Error(String(err))),
      );
      if (result.CommandUUID) {
        yield* service.handleCommandResult(result, identityCertificate);
      }
      if (!udid) return HttpServerResponse.empty({ status: 200 });
      const command = yield* service.handleCheckin(scope());
      if (!command) return HttpServerResponse.empty({ status: 200 });
      return HttpServerResponse.text(yield* commandBytes(command), {
        contentType: "application/xml",
      });
    }

    if (!udid) return HttpServerResponse.empty({ status: 400 });
    const command = yield* service.handleCheckin(scope());
    if (!command) {
      const empty = yield* serializePlist({});
      return HttpServerResponse.text(empty, { contentType: "application/xml" });
    }
    return HttpServerResponse.text(yield* commandBytes(command), {
      contentType: "application/xml",
    });
  }).pipe(
    Effect.match({
      onSuccess: (val) => val,
      onFailure: (err) => {
        console.error("mdm error:", err);
        return HttpServerResponse.empty({ status: 400 });
      },
    }),
  );
}

function handleAsset(request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    const service = yield* AppleMdmService;
    const identityCertificate = request.headers["x-device-identity-certificate"] as
      | string
      | undefined;
    const url = new URL(request.url, "http://localhost");
    const identifier = url.pathname.replace("/mdm/apple/assets/", "");
    if (!identifier) return HttpServerResponse.empty({ status: 404 });

    const token = url.searchParams.get("token") ?? undefined;
    const asset = yield* service.handleAsset(identityCertificate, identifier, token);
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

// DDM `ProfileURL` targets. Signed URLs authenticate without the MDM check-in
// identity certificate, because Declarative Management fetches them directly.
function handleProfile(request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    const service = yield* AppleMdmService;
    const url = new URL(request.url, "http://localhost");
    const prefix = "/mdm/apple/profiles/";
    if (!url.pathname.startsWith(prefix)) return HttpServerResponse.empty({ status: 404 });
    const [deviceToken, policyId, kind] = url.pathname
      .slice(prefix.length)
      .split("/")
      .map((part) => decodeURIComponent(part));
    if (!deviceToken || !policyId || !kind) return HttpServerResponse.empty({ status: 404 });

    const profile = yield* service.handleProfile(
      deviceToken,
      policyId,
      kind,
      url.searchParams.get("token") ?? undefined,
    );
    if (!profile) return HttpServerResponse.empty({ status: 404 });

    return HttpServerResponse.uint8Array(profile.content, {
      contentType: profile.contentType,
      headers: {
        "Content-Disposition": `attachment; filename="${policyId}.mobileconfig"`,
      },
    });
  }).pipe(
    Effect.match({
      onSuccess: (val) => val,
      onFailure: (err) => {
        console.error("profile error:", err);
        return HttpServerResponse.empty({ status: 500 });
      },
    }),
  );
}

export const appleMdmRoutes = Layer.mergeAll(
  HttpRouter.add("PUT", "/mdm/apple/mdm", handleMdm),
  HttpRouter.add("GET", "/mdm/apple/assets/:identifier", handleAsset),
  HttpRouter.add("GET", "/mdm/apple/profiles/:deviceToken/:policyId/:kind", handleProfile),
);
