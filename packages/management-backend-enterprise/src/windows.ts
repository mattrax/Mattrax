import { Effect } from "effect";
import { and, asc, eq, lt } from "drizzle-orm";
import { windowsPolicyNodes } from "./policy.ts";
import { schema as s, type Db } from "@mattrax/enterprise-core";
import { signScepCsr } from "@mattrax/scep";
import {
  InternalServerError,
  UnknownDevice,
  type ManagementBackend,
  type WindowsDeviceEvent,
  type WindowsDiscoveryRequest,
  type WindowsDiscoveryResponse,
  type WindowsEnrollmentPolicy,
  type WindowsEnrollmentRequest,
  type WindowsEnrollmentResult,
  type WindowsManagementRequest,
  type WindowsManagementResponse,
  type WindowsManagementScope,
} from "@mattrax/management-backend";

const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const hmac = async (secret: string, message: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toBase64Url(new Uint8Array(signature));
};

const timingSafeEqual = (left: string, right: string): boolean => {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index]! ^ b[index]!;
  return difference === 0;
};

export type WindowsEnrollmentTokenOptions = {
  /** Lifetime in seconds. Defaults to one hour. */
  readonly ttlSeconds?: number;
  /** Injectable clock in milliseconds, for tests. */
  readonly now?: number;
};

export type WindowsEnrollmentTokenVerification = {
  readonly subject: string;
  readonly issuedAt: number;
};

const DEFAULT_ENROLLMENT_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * Stateless WSTEP enrollment token.
 *
 * Encoding: `<subject>.<issuedAtEpochSeconds>.<base64url HMAC-SHA256>`, signed
 * with the application `AUTH_SECRET`. The policy response hands this token back
 * to Windows, which echoes it in the enrollment request's
 * `BinarySecurityToken`; {@link verifyWindowsEnrollmentToken} rejects forged,
 * malformed and expired tokens.
 *
 * The subject is a fresh enrollment id until the device supplies its real
 * `DeviceID` in the enrollment AdditionalContext. Keeping the token stateless
 * means a retried policy request can safely issue a new token without a database
 * write.
 */
export const createWindowsEnrollmentToken = (
  subject: string,
  authSecret: string,
  options: WindowsEnrollmentTokenOptions = {},
): Promise<string> =>
  (async () => {
    if (!subject) throw new Error("Windows enrollment token subject is required");
    if (!authSecret) throw new Error("Windows enrollment token requires a secret");
    const issuedAt = Math.floor((options.now ?? Date.now()) / 1000);
    const signature = await hmac(authSecret, `${subject}.${issuedAt}`);
    return `${subject}.${issuedAt}.${signature}`;
  })();

export const verifyWindowsEnrollmentToken = (
  token: string | undefined,
  authSecret: string,
  options: WindowsEnrollmentTokenOptions = {},
): Promise<WindowsEnrollmentTokenVerification | null> =>
  (async () => {
    if (!token || !authSecret) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [subject, issuedAtRaw, signature] = parts;
    if (!subject || !issuedAtRaw || !signature) return null;
    const issuedAt = Number(issuedAtRaw);
    if (!Number.isFinite(issuedAt)) return null;

    const expected = await hmac(authSecret, `${subject}.${issuedAtRaw}`);
    if (!timingSafeEqual(expected, signature)) return null;

    const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
    const ttlSeconds = options.ttlSeconds ?? DEFAULT_ENROLLMENT_TOKEN_TTL_SECONDS;
    if (nowSeconds > issuedAt + ttlSeconds) return null;
    // Allow a little clock skew for freshly issued tokens.
    if (issuedAt > nowSeconds + 60) return null;

    return { subject, issuedAt };
  })();

export type WindowsBackendOptions = {
  readonly db: Db["Service"];
  readonly origin: string;
  /** Shared application secret used to sign/verify WSTEP enrollment tokens. */
  readonly authSecret?: string;
  /**
   * Tenant that owns Windows devices. Windows discovery/enrollment carries no
   * tenant identity, so this backend fails closed when the pin is unset rather
   * than guessing a tenant. Configure this to enable Windows enrollment.
   */
  readonly windowsOrganizationId?: string;
  readonly enrollmentTokenTtlSeconds?: number;
  /** Require a verified client certificate on SyncML check-in. */
  readonly requireDeviceIdentity?: boolean;
};

type WindowsBackend = Pick<
  ManagementBackend.Service,
  | "windowsDiscovery"
  | "getWindowsEnrollmentPolicy"
  | "windowsEnroll"
  | "windowsManagementCheckin"
  | "windowsDeviceEvent"
>;

export const makeWindowsBackend = (options: WindowsBackendOptions): WindowsBackend => {
  const { db, origin, authSecret, windowsOrganizationId, requireDeviceIdentity } = options;
  const ttlSeconds = options.enrollmentTokenTtlSeconds ?? DEFAULT_ENROLLMENT_TOKEN_TTL_SECONDS;
  const internal = () => new InternalServerError();

  const requireSecret = (): Effect.Effect<string, InternalServerError> =>
    authSecret ? Effect.succeed(authSecret) : Effect.fail(new InternalServerError());

  const resolveOrganizationId = (): Effect.Effect<string, InternalServerError> =>
    // Windows discovery has no tenant identity. A deployment-wide pin is the
    // only safe mapping; guessing the earliest tenant would let an anonymous
    // caller enroll into the wrong workspace.
    windowsOrganizationId
      ? Effect.succeed(windowsOrganizationId)
      : Effect.fail(new InternalServerError());

  const findDevice = (organizationId: string, deviceId: string) =>
    Effect.gen(function* () {
      const [device] = yield* db
        .select()
        .from(s.device)
        .where(
          and(eq(s.device.organizationId, organizationId), eq(s.device.dmIdentifier, deviceId)),
        )
        .limit(1);
      return device ?? null;
    });

  const insertDevice = (input: {
    readonly organizationId: string;
    readonly deviceId: string;
    readonly name: string;
    readonly timestamp: Date;
  }) =>
    db.insert(s.device).values({
      id: crypto.randomUUID().replaceAll("-", "").slice(0, 24),
      organizationId: input.organizationId,
      proto: "win",
      status: "enrolled",
      name: input.name,
      vendor: "Microsoft",
      dmIdentifier: input.deviceId,
      enrolledAt: input.timestamp,
      lastSeenAt: input.timestamp,
    });

  const touchDevice = (deviceId: string, timestamp: Date) =>
    db.update(s.device).set({ lastSeenAt: timestamp }).where(eq(s.device.id, deviceId));

  return {
    windowsDiscovery: (
      _request: WindowsDiscoveryRequest,
    ): Effect.Effect<WindowsDiscoveryResponse, InternalServerError> =>
      Effect.gen(function* () {
        yield* resolveOrganizationId();
        return {
          authPolicy: "OnPremise",
          // MS-MDE2 enrollment version supported by the WSTEP implementation.
          enrollmentVersion: "4.0",
          enrollmentPolicyServiceUrl: `${origin}/mdm/windows/policy`,
          enrollmentServiceUrl: `${origin}/mdm/windows/enroll`,
        };
      }),

    getWindowsEnrollmentPolicy: (
      authToken: string,
    ): Effect.Effect<WindowsEnrollmentPolicy, InternalServerError> =>
      Effect.gen(function* () {
        const secret = yield* requireSecret();
        yield* resolveOrganizationId();
        // A device may retry the policy call; keep the subject stable when it
        // presents one of our own still-valid tokens.
        const existing = yield* Effect.promise(() =>
          verifyWindowsEnrollmentToken(authToken, secret, { ttlSeconds }),
        );
        const subject = existing?.subject ?? crypto.randomUUID();
        const issued = yield* Effect.promise(() =>
          createWindowsEnrollmentToken(subject, secret, { ttlSeconds }),
        );
        return {
          minimalKeyLength: "2048",
          certificateValidityPeriodSeconds: "31536000",
          renewalPeriodSeconds: "15552000",
          authToken: issued,
        };
      }).pipe(Effect.mapError(internal)),

    windowsEnroll: (
      request: WindowsEnrollmentRequest,
    ): Effect.Effect<WindowsEnrollmentResult, UnknownDevice | InternalServerError> =>
      Effect.gen(function* () {
        const secret = yield* requireSecret();
        const verification = yield* Effect.promise(() =>
          verifyWindowsEnrollmentToken(request.authToken, secret, { ttlSeconds }),
        );
        if (!verification) return yield* Effect.fail(new UnknownDevice());

        const deviceIdentifier = request.deviceId?.trim() || verification.subject;
        const organizationId = yield* resolveOrganizationId();
        const [enrollment] = yield* db
          .select()
          .from(s.enterpriseEnrollment)
          .where(eq(s.enterpriseEnrollment.organizationId, organizationId))
          .limit(1);
        if (!enrollment?.enabledWindows) return yield* Effect.fail(new UnknownDevice());
        // `maxDevices === 0` means unlimited for the tenant.
        if (enrollment.maxDevices > 0) {
          const windowsDevices = yield* db
            .select({ id: s.device.id })
            .from(s.device)
            .where(and(eq(s.device.organizationId, organizationId), eq(s.device.proto, "win")))
            .limit(enrollment.maxDevices);
          if (windowsDevices.length >= enrollment.maxDevices)
            return yield* Effect.fail(new UnknownDevice());
        }

        const [ca] = yield* db.select().from(s.scepCa).where(eq(s.scepCa.id, 1)).limit(1);
        if (!ca || typeof ca.privateKeyJwk !== "object" || ca.privateKeyJwk === null) {
          return yield* Effect.fail(internal());
        }

        const timestamp = new Date();
        const signed = yield* signScepCsr({
          csr: request.csr,
          caCertPem: ca.certPem,
          caPrivateKeyJwk: ca.privateKeyJwk as JsonWebKey,
          notBefore: timestamp,
          notAfter: new Date(timestamp.getTime() + 365 * 24 * 60 * 60 * 1000),
          deviceId: deviceIdentifier,
          organizationalUnit: organizationId,
        }).pipe(Effect.mapError(internal));

        const serial = Array.from(
          signed.certificate.serialNumber.valueBlock.valueHexView ??
            new Uint8Array(
              signed.certificate.serialNumber.valueBlock.valueHex ?? new ArrayBuffer(0),
            ),
          (byte) => byte.toString(16).padStart(2, "0"),
        )
          .join("")
          .replace(/^0+(?=.)/, "");
        yield* db.insert(s.scepIssuedCertificate).values({
          serial,
          organizationId,
          enrollmentId: null,
          deviceId: deviceIdentifier,
          notAfter: new Date(timestamp.getTime() + 365 * 24 * 60 * 60 * 1000),
          createdAt: timestamp,
        });

        const name = request.deviceName?.trim() || deviceIdentifier;
        const existing = yield* findDevice(organizationId, deviceIdentifier);
        if (existing) {
          yield* db
            .update(s.device)
            .set({
              proto: "win",
              status: "enrolled",
              name: request.deviceName?.trim() || existing.name,
              vendor: "Microsoft",
              dmIdentifier: deviceIdentifier,
              lastSeenAt: timestamp,
            })
            .where(eq(s.device.id, existing.id));
        } else {
          yield* insertDevice({ organizationId, deviceId: deviceIdentifier, name, timestamp });
        }

        return {
          deviceId: deviceIdentifier,
          signedCertificate: signed.certificatePem,
          identityCertificate: ca.certPem,
          // The provisioning document uses these for the APPSRV DIGEST
          // challenge. The management endpoint does not currently issue
          // commands, so the secret only needs to be unguessable.
          username: deviceIdentifier,
          secret: crypto.randomUUID(),
          providerId: "Mattrax",
        };
      }).pipe(Effect.mapError((cause) => (cause instanceof UnknownDevice ? cause : internal()))),

    windowsManagementCheckin: (
      scope: WindowsManagementScope,
      checkinRequest: WindowsManagementRequest,
    ): Effect.Effect<WindowsManagementResponse, UnknownDevice | InternalServerError> =>
      Effect.gen(function* () {
        const organizationId = yield* resolveOrganizationId();
        if (requireDeviceIdentity) {
          const certificate = scope.identityCertificate ?? "";
          const subjectOu = certificate.match(/(?:^|[,/\n])\s*OU\s*=\s*([^,/\n]+)/i)?.[1]?.trim();
          const subjectCn = certificate.match(/(?:^|[,/\n])\s*CN\s*=\s*([^,/\n]+)/i)?.[1]?.trim();
          if (!certificate || subjectOu !== organizationId) {
            return yield* Effect.fail(new UnknownDevice());
          }
          if (subjectCn && subjectCn !== scope.deviceId) {
            return yield* Effect.fail(new UnknownDevice());
          }
        }
        const device = yield* findDevice(organizationId, scope.deviceId);
        if (!device) return yield* Effect.fail(new UnknownDevice());
        yield* touchDevice(device.id, new Date());

        for (const status of checkinRequest.statuses) {
          const entry = status as { cmdRef?: unknown; data?: unknown };
          const commandId = typeof entry.cmdRef === "string" ? entry.cmdRef : undefined;
          if (!commandId) continue;
          const data = String(entry.data ?? "");
          yield* db
            .update(s.deviceCommand)
            .set({
              status: data === "200" ? "succeeded" : data === "418" ? "queued" : "failed",
              resultStatus: data,
              updatedAt: new Date(),
            })
            .where(and(eq(s.deviceCommand.id, commandId), eq(s.deviceCommand.deviceId, device.id)));
        }

        const groupedConfigurations = yield* db
          .select({
            policyId: s.configuration.policyId,
            kind: s.configuration.kind,
            data: s.configuration.data,
          })
          .from(s.configuration)
          .innerJoin(s.policy, eq(s.policy.id, s.configuration.policyId))
          .innerJoin(s.groupPolicy, eq(s.groupPolicy.policyId, s.configuration.policyId))
          .innerJoin(s.groupDevice, eq(s.groupDevice.groupId, s.groupPolicy.groupId))
          .where(eq(s.groupDevice.deviceId, device.id))
          .limit(1000);
        const directConfigurations = yield* db
          .select({
            policyId: s.configuration.policyId,
            kind: s.configuration.kind,
            data: s.configuration.data,
          })
          .from(s.configuration)
          .innerJoin(s.policy, eq(s.policy.id, s.configuration.policyId))
          .innerJoin(s.devicePolicy, eq(s.devicePolicy.policyId, s.configuration.policyId))
          .where(eq(s.devicePolicy.deviceId, device.id))
          .limit(1000);
        const configurationKeys = new Set(
          groupedConfigurations.map((row) => `${row.policyId}:${row.kind}`),
        );
        const configurations = [
          ...groupedConfigurations,
          ...directConfigurations.filter(
            (row) => !configurationKeys.has(`${row.policyId}:${row.kind}`),
          ),
        ];

        const commands: Array<{
          kind: string;
          cmdID: string;
          locURI?: string;
          data?: string;
          format?: string;
        }> = [];
        // 1 is reserved for the SyncHdr status; server commands start at 2.
        let index = 2;
        // Resolve duplicate OMA-URIs deterministically. A policy with a
        // lexicographically smaller id wins, so check-ins are stable across
        // group ordering and devices.
        const desired = new Map<
          string,
          { readonly policyId: string; readonly data: string; readonly format?: string }
        >();
        const sorted = [...configurations].sort((left, right) =>
          String(left.policyId).localeCompare(String(right.policyId)),
        );
        for (const configuration of sorted) {
          for (const node of windowsPolicyNodes({
            policyId: configuration.policyId,
            kind: configuration.kind,
            data: configuration.data,
            hash: "",
          })) {
            if (desired.has(node.omaUri)) continue;
            desired.set(node.omaUri, {
              policyId: configuration.policyId,
              data:
                typeof node.value === "string"
                  ? node.value
                  : typeof node.value === "object"
                    ? JSON.stringify(node.value)
                    : String(node.value),
              ...(node.format ? { format: node.format } : {}),
            });
          }
        }
        for (const [locURI, node] of desired) {
          commands.push({
            kind: "Replace",
            cmdID: String(index++),
            locURI,
            data: node.data,
            ...(node.format ? { format: node.format } : {}),
          });
        }

        // Commands handed out but never acknowledged would otherwise stay
        // "sent" forever. Re-queue them so the next check-in retries.
        yield* db
          .update(s.deviceCommand)
          .set({ status: "queued", updatedAt: new Date() })
          .where(
            and(
              eq(s.deviceCommand.deviceId, device.id),
              eq(s.deviceCommand.status, "sent"),
              lt(s.deviceCommand.updatedAt, new Date(Date.now() - 30 * 60 * 1000)),
            ),
          );
        const queued = yield* db
          .select()
          .from(s.deviceCommand)
          .where(and(eq(s.deviceCommand.deviceId, device.id), eq(s.deviceCommand.status, "queued")))
          .orderBy(asc(s.deviceCommand.createdAt))
          .limit(1000);
        for (const command of queued) {
          const payload = (command.payload ?? {}) as { locURI?: string; data?: string };
          commands.push({
            kind: "Exec",
            cmdID: command.id,
            locURI: payload.locURI ?? "./Device/Vendor/MSFT/RemoteWipe/doWipeProtected",
            data: payload.data ?? "",
            format: "chr",
          });
          yield* db
            .update(s.deviceCommand)
            .set({ status: "sent", updatedAt: new Date() })
            .where(eq(s.deviceCommand.id, command.id));
        }

        return { commands };
      }).pipe(Effect.mapError((cause) => (cause instanceof UnknownDevice ? cause : internal()))),

    windowsDeviceEvent: (
      scope: WindowsManagementScope,
      event: WindowsDeviceEvent,
    ): Effect.Effect<void, UnknownDevice | InternalServerError> =>
      Effect.gen(function* () {
        const organizationId = yield* resolveOrganizationId();
        const deviceId = event.deviceId || scope.deviceId;
        const device = yield* findDevice(organizationId, deviceId);
        const timestamp = new Date();

        if (event._tag === "Enrolled") {
          if (device) {
            yield* db
              .update(s.device)
              .set({ status: "enrolled", lastSeenAt: timestamp })
              .where(eq(s.device.id, device.id));
          } else {
            yield* insertDevice({
              organizationId,
              deviceId,
              name: deviceId,
              timestamp,
            });
          }
          return;
        }

        if (!device) return yield* Effect.fail(new UnknownDevice());
        // ManagementCheckin and CommandResult both prove liveness. Command
        // history is not persisted because command delivery is not implemented.
        yield* touchDevice(device.id, timestamp);
      }).pipe(Effect.mapError((cause) => (cause instanceof UnknownDevice ? cause : internal()))),
  };
};
