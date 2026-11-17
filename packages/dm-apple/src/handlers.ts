import { Effect, Layer, Schema } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { HttpServerResponse, HttpRouter, HttpServerRequest } from "effect/http";
import { AppleMdmService, appleCheckinScope } from "./service.js";
import { MDM_ASSET_CACHE_CONTROL, MDM_PROFILE_CACHE_CONTROL } from "./cache.js";
import { parsePlist, serializePlist, PlistValue } from "@mattrax/plist";
import {
  AuthenticatePlist,
  DeviceUnenrolled,
  GetTokenPlist,
  TokenUpdatePlist,
  UserAuthenticatePlist,
  CheckOutPlist,
  CommandResultPlist,
  DDMStatusReport,
  GetBootstrapTokenPlist,
  SetBootstrapTokenPlist,
  ReturnToServicePlist,
  resolveCheckinChannel,
} from "./schema.js";
import { appleMdmApi } from "./domain.js";
import { CheckinScope } from "@mattrax/management-backend";

const PlistDictionary = Schema.Record(Schema.String, PlistValue);

const json = (body: Schema.Json, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

function plistField(value: PlistValue, key: string): PlistValue | undefined {
  if (!Schema.is(PlistDictionary)(value)) return undefined;

  return value[key];
}

function plistString(value: PlistValue, key: string): string | undefined {
  const field = plistField(value, key);

  return Schema.is(Schema.String)(field) ? field : undefined;
}

const decodeBase64 = (value: string): Uint8Array => {
  const cleaned = value.replace(/\s/g, "");
  const padded = cleaned.padEnd(cleaned.length + ((4 - (cleaned.length % 4)) % 4), "=");
  const binary = atob(padded);

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const commandBytes = (command: {
  commandUUID: string;
  requestType: string;
  payload: PlistValue;
}) => {
  const entries: Array<[string, PlistValue]> = [["RequestType", command.requestType]];

  if (Schema.is(PlistDictionary)(command.payload)) {
    for (const [key, value] of Object.entries(command.payload)) {
      if (key !== "RequestType") entries.push([key, value]);
    }
  }

  return serializePlist({
    CommandUUID: command.commandUUID,
    Command: Object.fromEntries(entries),
  });
};

type ReturnToServiceResponse = {
  Enabled: boolean;
  WiFiProfileData?: PlistValue;
  BootstrapToken?: PlistValue;
};

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

    const identityCertificate = request.headers["x-device-identity-certificate"];
    const identityCertificateSerial = request.headers["x-device-identity-certificate-serial"];

    const verifiedSignature = yield* service.verifyDeviceSignature({
      signature: request.headers["mdm-signature"],
      body: buf,
      identityCertificateSubject: identityCertificate,
      identityCertificateSerial,
      identityCertificateFingerprintSha256: request.headers["x-device-identity-certificate-sha256"],
    });

    const identityFingerprint = verifiedSignature?.fingerprintSha256;
    // Prefer the serial from the verified CMS signer (canonical lowercase hex)
    // over the forwarded header, which is only checked when trust is wired.
    const identitySerial = verifiedSignature?.serial ?? identityCertificateSerial;
    const text = new TextDecoder().decode(buf);
    const plist = yield* parsePlist(text);

    const messageType = plistString(plist, "MessageType");
    const status = plistField(plist, "Status");

    // Device enrollments report UDID; Apple User Enrollment reports the
    // per-enrollment identifier instead, and the user channel adds UserID (or
    // EnrollmentUserID for a user enrollment).
    const channel = resolveCheckinChannel({
      UDID: plistString(plist, "UDID"),
      EnrollmentID: plistString(plist, "EnrollmentID"),
      UserID: plistString(plist, "UserID"),
      EnrollmentUserID: plistString(plist, "EnrollmentUserID"),
      UserShortName: plistString(plist, "UserShortName"),
      UserLongName: plistString(plist, "UserLongName"),
    });

    const scope = (): CheckinScope | null =>
      channel
        ? appleCheckinScope(
            service.mdmOrigin,
            channel,
            identityCertificate,
            identityFingerprint,
            identitySerial,
          )
        : null;

    if (messageType) {
      switch (messageType) {
        case "Authenticate": {
          const auth = yield* Schema.decodeUnknownEffect(AuthenticatePlist)(plist).pipe(
            Effect.mapError((err) => new Error(String(err))),
          );

          // An ADE device can receive its tenant's signed enrollment profile
          // directly from the check-in response, which removes the manual
          // profile install from the Setup Assistant flow. The signed URL
          // remains the canonical fallback, so no payload is valid here.
          const result = yield* service.handleAuthenticate(
            auth,
            identityCertificate,
            identityFingerprint,
            identitySerial,
          );

          if (!result?.enrollmentProfile) return HttpServerResponse.empty({ status: 200 });

          return HttpServerResponse.text(
            yield* serializePlist({
              EnrollmentProfile: decodeBase64(result.enrollmentProfile),
            } satisfies PlistValue),
            { contentType: "application/xml" },
          );
        }

        case "TokenUpdate": {
          const update = yield* Schema.decodeUnknownEffect(TokenUpdatePlist)(plist).pipe(
            Effect.mapError((err) => new Error(String(err))),
          );

          yield* service.handleTokenUpdate(
            update,
            identityCertificate,
            identityFingerprint,
            identitySerial,
          );

          return HttpServerResponse.empty({ status: 200 });
        }

        case "CheckOut": {
          const checkout = yield* Schema.decodeUnknownEffect(CheckOutPlist)(plist).pipe(
            Effect.mapError((err) => new Error(String(err))),
          );

          yield* service.handleCheckOut(
            checkout,
            identityCertificate,
            identityFingerprint,
            identitySerial,
          );

          return HttpServerResponse.empty({ status: 200 });
        }

        case "DeclarativeManagement": {
          const endpoint = plistString(plist, "Endpoint");
          const checkinScope = scope();

          if (!checkinScope) return HttpServerResponse.empty({ status: 400 });

          if (endpoint === "tokens") {
            const tokens = yield* service.handleDeclarativeTokens(checkinScope);

            return json(tokens);
          }

          if (endpoint === "declaration-items") {
            const items = yield* service.handleDeclarationItems(checkinScope);

            return json(items);
          }

          if (endpoint === "status") {
            const data = plistString(plist, "Data");

            if (data === undefined) return HttpServerResponse.empty({ status: 400 });

            const parsed = yield* Effect.try({
              try: () =>
                Schema.decodeUnknownSync(Schema.Json)(
                  JSON.parse(new TextDecoder().decode(decodeBase64(data))),
                ),
              catch: (cause) => new Error(`Invalid DDM status report: ${String(cause)}`),
            });

            const decoded = yield* Schema.decodeUnknownEffect(DDMStatusReport)(parsed).pipe(
              Effect.mapError((err) => new Error(String(err))),
            );

            yield* service.handleStatusReport(checkinScope, decoded);

            return HttpServerResponse.empty({ status: 200 });
          }

          if (endpoint !== undefined && endpoint.startsWith("declaration/")) {
            const parts = endpoint.split("/");

            if (parts.length !== 3) return HttpServerResponse.empty({ status: 400 });
            const [, type, identifier] = parts;

            if (type === undefined || identifier === undefined)
              return HttpServerResponse.empty({ status: 400 });

            if (!["activation", "configuration", "asset", "management"].includes(type))
              return HttpServerResponse.empty({ status: 404 });
            const decl = yield* service.handleDeclaration(checkinScope, type, identifier);

            return json(decl);
          }

          return HttpServerResponse.empty({ status: 404 });
        }

        case "SetBootstrapToken": {
          const token = yield* Schema.decodeUnknownEffect(SetBootstrapTokenPlist)(plist).pipe(
            Effect.mapError((err) => new Error(String(err))),
          );

          // Bootstrap token escrow is a device-level secret; Apple never sends
          // it on a user channel and a user connection must not write one.
          if (channel?.kind === "user") return HttpServerResponse.empty({ status: 400 });

          yield* service.handleSetBootstrapToken(
            token.BootstrapToken ?? "",
            identityCertificate,
            token.UDID ?? token.EnrollmentID,
            identitySerial,
            identityFingerprint,
          );

          return HttpServerResponse.empty({ status: 200 });
        }

        case "GetBootstrapToken": {
          const request = yield* Schema.decodeUnknownEffect(GetBootstrapTokenPlist)(plist).pipe(
            Effect.mapError((err) => new Error(String(err))),
          );

          if (channel?.kind === "user") return HttpServerResponse.empty({ status: 400 });

          const value = yield* service.handleGetBootstrapToken(
            identityCertificate,
            request.UDID ?? request.EnrollmentID,
            identitySerial,
            identityFingerprint,
          );

          if (!value) return HttpServerResponse.empty({ status: 200 });
          const binary = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

          return HttpServerResponse.text(yield* serializePlist({ BootstrapToken: binary }), {
            contentType: "application/xml",
          });
        }

        case "GetToken": {
          // `GetToken` is Apple's token-service check-in (Managed Apple Account
          // access management via `com.apple.maid`, and Apple Watch pairing) —
          // not the user channel's `AuthToken`, which `UserAuthenticate`
          // negotiates. Mattrax issues neither token: the MAID token must be
          // signed with the ABM-assigned server UUID, and watches are not
          // managed. Apple requires a 400 for a service type the server does
          // not support, and the enrollment profile no longer advertises the
          // `com.apple.mdm.token` capability, so a conforming device will not
          // ask.
          yield* Schema.decodeUnknownEffect(GetTokenPlist)(plist).pipe(
            Effect.mapError((err) => new Error(String(err))),
          );

          return HttpServerResponse.empty({ status: 400 });
        }

        case "ReturnToService": {
          yield* Schema.decodeUnknownEffect(ReturnToServicePlist)(plist).pipe(
            Effect.mapError((err) => new Error(String(err))),
          );

          // Setup Assistant runs on the device channel only.
          if (channel?.kind === "user") return HttpServerResponse.empty({ status: 400 });

          const checkinScope = scope();

          if (!checkinScope) return HttpServerResponse.empty({ status: 400 });

          const configuration = yield* service.handleReturnToService(checkinScope);

          const response: ReturnToServiceResponse = { Enabled: configuration.enabled };

          if (configuration.enabled) {
            if (configuration.wifiProfileData)
              response["WiFiProfileData"] = configuration.wifiProfileData;

            if (configuration.bootstrapToken)
              response["BootstrapToken"] = configuration.bootstrapToken;
          }

          return HttpServerResponse.text(yield* serializePlist({ ReturnToService: response }), {
            contentType: "application/xml",
          });
        }

        case "UserAuthenticate": {
          const auth = yield* Schema.decodeUnknownEffect(UserAuthenticatePlist)(plist).pipe(
            Effect.mapError((err) => new Error(String(err))),
          );

          const result = yield* service.handleUserAuthenticate(
            auth,
            identityCertificate,
            identityFingerprint,
            identitySerial,
          );

          // 410 tells the client not to manage this user for the rest of the
          // login session.
          if (!result) return HttpServerResponse.empty({ status: 410 });

          // SAFETY: the branch builds one of two string-keyed dictionaries, both
          // of which are valid plist dictionaries.
          const body = (
            result.digestChallenge !== undefined
              ? { DigestChallenge: result.digestChallenge }
              : { AuthToken: result.authToken ?? "" }
          ) as PlistValue;

          return HttpServerResponse.text(yield* serializePlist(body), {
            contentType: "application/xml",
          });
        }

        default:
          return HttpServerResponse.empty({ status: 400 });
      }
    }

    if (status !== undefined) {
      const result = yield* Schema.decodeUnknownEffect(CommandResultPlist)(plist).pipe(
        Effect.mapError((err) => new Error(String(err))),
      );

      if (result.CommandUUID) {
        yield* service.handleCommandResult(
          result,
          identityCertificate,
          identityFingerprint,
          identitySerial,
        );
      }

      const checkinScope = scope();

      if (!checkinScope) return HttpServerResponse.empty({ status: 200 });
      const command = yield* service.handleCheckin(checkinScope);

      if (!command) return HttpServerResponse.empty({ status: 200 });

      return HttpServerResponse.text(yield* commandBytes(command), {
        contentType: "application/xml",
      });
    }

    const checkinScope = scope();

    if (!checkinScope) return HttpServerResponse.empty({ status: 400 });
    const command = yield* service.handleCheckin(checkinScope);

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
        if (err instanceof DeviceUnenrolled) return HttpServerResponse.empty({ status: 410 });
        console.error("mdm error:", err);

        return HttpServerResponse.empty({ status: 400 });
      },
    }),
  );
}

function handleAsset(request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    const service = yield* AppleMdmService;

    const identityCertificate = request.headers["x-device-identity-certificate"];

    const url = new URL(request.url, "http://localhost");
    const identifier = url.pathname.replace("/mdm/apple/assets/", "");

    if (!identifier) return HttpServerResponse.empty({ status: 404 });

    const token = url.searchParams.get("token") ?? undefined;
    const asset = yield* service.handleAsset(identityCertificate, identifier, token);

    if (!asset) return HttpServerResponse.empty({ status: 404 });

    return HttpServerResponse.uint8Array(asset.content, {
      contentType: asset.contentType,
      headers: { "Cache-Control": MDM_ASSET_CACHE_CONTROL },
    });
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

    const expiresAtRaw = url.searchParams.get("expiresAt");
    const expiresAt = expiresAtRaw && /^\d+$/.test(expiresAtRaw) ? Number(expiresAtRaw) : undefined;

    const profile = yield* service.handleProfile(
      deviceToken,
      policyId,
      kind,
      url.searchParams.get("token") ?? undefined,
      url.searchParams.get("deviceId") ?? undefined,
      expiresAt,
    );

    if (!profile) return HttpServerResponse.empty({ status: 404 });

    return HttpServerResponse.uint8Array(profile.content, {
      contentType: profile.contentType,
      headers: {
        "Cache-Control": MDM_PROFILE_CACHE_CONTROL,
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
