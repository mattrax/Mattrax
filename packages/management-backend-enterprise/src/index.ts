import { Effect, Layer } from "effect";
import { and, eq } from "drizzle-orm";
import { Db, schema as s } from "@mattrax/enterprise-core";
import { ApnsService } from "@mattrax/apns";
import { importPrivateKeyJwk, openSecret, pemEncode } from "@mattrax/crypto";
import { buildAppleEnrollmentProfile } from "@mattrax/dm-apple";
import {
  InternalServerError,
  ManagementBackend,
  ServerInitiatedUnenrollment,
  UnknownDevice,
  type AppleDeviceEvent,
  type CheckinScope,
  type DdmDeclarationItems,
  type DdmTokens,
  type ManagementManifest,
} from "@mattrax/management-backend";
import { makeWindowsBackend } from "./windows.ts";
import {
  buildAssetContent,
  buildAssetDeclaration,
  buildConfigurationDeclaration,
  buildLegacyProfile,
  certificateAllowsOrganization,
  configurationAssetIdentifier,
  configurationAssetServerToken,
  configurationDeclarationIdentifier,
  configurationServerToken,
  isCertificateKind,
  parseConfigurationKind,
  splitConfigurationAssetIdentifier,
  splitConfigurationDeclarationIdentifier,
  verifyAssetRequestToken,
  type DeclarationContext,
  type PolicyConfigurationRow,
} from "./policy.ts";

const DEVICE_INFORMATION_ACTIVATION_ID = "DAAF574F-36D4-4089-B2E3-D2008B65D5BE";
const DEVICE_INFORMATION_ACTIVATION_SERVER_TOKEN = "660CF896-1647-4FAD-B8A8-7A2190B5B554";
const DEVICE_INFORMATION_CONFIGURATION_ID = "13DE3EE0-D5A8-46E9-B967-27E56A4D918F";
const DEVICE_INFORMATION_CONFIGURATION_SERVER_TOKEN = "6C4178EE-B3BF-496D-A110-12EE4BC2A781";
const MANAGEMENT_DECLARATION_ID = "F8C4C3A1-2B6E-4D7F-A9E5-3C8B7D9E2F4A";
const MANAGEMENT_DECLARATION_SERVER_TOKEN = "CFC79DC6-B2A3-434D-8F2A-E03E11197A67";

const DEVICE_INFORMATION_STATUS_ITEMS = [
  "device.identifier.serial-number",
  "device.identifier.udid",
  "device.model.family",
  "device.model.identifier",
  "device.model.marketing-name",
  "device.model.number",
  "device.operating-system.build-version",
  "device.operating-system.family",
  "device.operating-system.marketing-name",
  "device.operating-system.supplemental.build-version",
  "device.operating-system.supplemental.extra-version",
  "device.operating-system.version",
  "device.power.battery-health",
  "diskmanagement.filevault.enabled",
  "management.client-capabilities",
  "management.declarations",
];

const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);
const now = () => new Date();

const internal = (_cause: unknown) => new InternalServerError();
const record = (value: unknown) =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
const stringField = (value: unknown, key: string) => {
  const field = record(value)?.[key];
  return typeof field === "string" ? field : undefined;
};

const decodeHeader = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const certificateOu = (identityCertificate: string | undefined): string | null => {
  if (!identityCertificate) return null;
  const text = decodeHeader(identityCertificate);
  return text.match(/(?:^|[,/\n])\s*OU\s*=\s*([^,/\n]+)/i)?.[1]?.trim() ?? null;
};

const certHash = async (identityCertificate: string | undefined) => {
  if (!identityCertificate) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(identityCertificate),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const hashToken = async (parts: Iterable<string>) => {
  const sorted = [...parts].sort();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sorted.join("|")));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
};

const jsonHash = async (value: unknown) => hashToken([JSON.stringify(value)]);

type DeviceRow = typeof s.device.$inferSelect;

const findDeviceByScope = (scope: CheckinScope): Effect.Effect<DeviceRow | null, unknown, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const [byUdid] = yield* db
      .select()
      .from(s.device)
      .where(eq(s.device.dmIdentifier, scope.udid))
      .limit(1);
    if (byUdid) return byUdid;
    return null;
  });

const scopedConfigurations = (deviceId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* db
      .select({
        kind: s.configuration.kind,
        policyId: s.configuration.policyId,
        data: s.configuration.data,
        hash: s.configuration.hash,
        organizationId: s.policy.organizationId,
        groupId: s.groupDevice.groupId,
      })
      .from(s.configuration)
      .innerJoin(s.policy, eq(s.policy.id, s.configuration.policyId))
      .innerJoin(s.groupPolicy, eq(s.groupPolicy.policyId, s.configuration.policyId))
      .innerJoin(s.groupDevice, eq(s.groupDevice.groupId, s.groupPolicy.groupId))
      .where(eq(s.groupDevice.deviceId, deviceId));
  });

const deviceTokenFor = (deviceId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const [apple] = yield* db
      .select({ deviceToken: s.deviceApple.deviceToken })
      .from(s.deviceApple)
      .where(eq(s.deviceApple.deviceId, deviceId))
      .limit(1);
    return apple?.deviceToken ?? deviceId;
  }).pipe(Effect.mapError(internal));

type ScopedConfiguration = PolicyConfigurationRow & { readonly groupId: string };

const declarationItemsForDevice = (
  deviceId: string,
  deviceToken: string,
  context: Pick<DeclarationContext, "origin" | "authSecret">,
): Effect.Effect<DdmDeclarationItems, unknown, Db> =>
  Effect.gen(function* () {
    const rows = (yield* scopedConfigurations(deviceId)) as Array<ScopedConfiguration>;
    const groups = new Map<string, Array<{ kind: string; policyId: string }>>();
    for (const row of rows) {
      const group = groups.get(row.groupId) ?? [];
      group.push(row);
      groups.set(row.groupId, group);
    }

    const activations = [
      {
        identifier: DEVICE_INFORMATION_ACTIVATION_ID,
        serverToken: DEVICE_INFORMATION_ACTIVATION_SERVER_TOKEN,
      },
    ];
    for (const [groupId, configurations] of groups) {
      activations.push({
        identifier: groupId,
        serverToken: yield* Effect.promise(() =>
          hashToken(
            configurations.map((row) => configurationDeclarationIdentifier(row.policyId, row.kind)),
          ),
        ),
      });
    }

    const uniqueConfigurations = new Map<string, ScopedConfiguration>();
    for (const row of rows)
      uniqueConfigurations.set(configurationDeclarationIdentifier(row.policyId, row.kind), row);

    const configurations = [
      {
        identifier: DEVICE_INFORMATION_CONFIGURATION_ID,
        serverToken: DEVICE_INFORMATION_CONFIGURATION_SERVER_TOKEN,
      },
      ...(yield* Effect.promise(() =>
        Promise.all(
          [...uniqueConfigurations].map(async ([identifier, row]) => ({
            identifier,
            serverToken: await configurationServerToken(row, {
              origin: context.origin,
              deviceToken,
            }),
          })),
        ),
      )),
    ];

    const assets = yield* Effect.promise(() =>
      Promise.all(
        [...uniqueConfigurations.values()]
          .filter((row) => isCertificateKind(row.kind))
          .map(async (row) => ({
            identifier: configurationAssetIdentifier(row.policyId, row.kind),
            serverToken: await configurationAssetServerToken(row, {
              origin: context.origin,
              deviceToken,
            }),
          })),
      ),
    );

    return {
      activations,
      configurations,
      assets,
      management: [
        { identifier: MANAGEMENT_DECLARATION_ID, serverToken: MANAGEMENT_DECLARATION_SERVER_TOKEN },
      ],
    };
  });

const updateInventoryFromStatus = (
  deviceId: string,
  statusItems: unknown,
): Effect.Effect<void, unknown, Db> =>
  Effect.gen(function* () {
    if (!statusItems || typeof statusItems !== "object") return;
    const root = statusItems as Record<string, unknown>;
    const device = record(root.device);
    const identifier = record(device?.identifier);
    const model = record(device?.model);
    const operatingSystem = record(device?.["operating-system"]);
    const update: Record<string, unknown> = { lastSeenAt: now() };
    if (stringField(identifier, "serial-number"))
      update.serial = stringField(identifier, "serial-number");
    if (stringField(model, "marketing-name")) update.model = stringField(model, "marketing-name");
    if (stringField(model, "identifier")) update.modelIdentifier = stringField(model, "identifier");
    if (stringField(operatingSystem, "marketing-name"))
      update.osEdition = stringField(operatingSystem, "marketing-name");
    if (stringField(operatingSystem, "version"))
      update.osVersion = stringField(operatingSystem, "version");
    if (stringField(operatingSystem, "build-version"))
      update.osBuild = stringField(operatingSystem, "build-version");
    const db = yield* Db;
    yield* db.update(s.device).set(update).where(eq(s.device.id, deviceId));
  });

export class ManagementBackendEnterpriseLive extends ManagementBackend {
  static readonly make = (options: {
    readonly db: Db["Service"];
    readonly origin: string;
    /** Push transport for the immediate post-enrollment check-in. */
    readonly apns?: ApnsService.Service;
    /** Application secret used to unseal the tenant APNs private key and sign Windows WSTEP tokens. */
    readonly authSecret?: string;
    /**
     * Tenant that owns Windows devices. When omitted, Windows enrollment uses the
     * earliest organization (ordered by `createdAt`, then `id`). Windows
     * discovery/enrollment carries no tenant identity, so this makes the choice
     * deterministic and lets multi-tenant deployments route Windows to a
     * dedicated organization.
     */
    readonly windowsOrganizationId?: string;
  }): ManagementBackend.Service => {
    const { db, origin, apns, authSecret } = options;
    const provideDb = <A, E>(effect: Effect.Effect<A, E, Db>) =>
      effect.pipe(Effect.provideService(Db, db));

    /**
     * mttx pushes a check-in immediately after a device first reports its push
     * token, so the freshly enrolled device receives its configuration without
     * waiting for the next poll. Failures are logged and ignored.
     */
    const pushEnrolledDevice = (deviceId: string, organizationId: string) =>
      Effect.gen(function* () {
        if (!apns || !authSecret) return;
        const [apple] = yield* db
          .select()
          .from(s.deviceApple)
          .where(eq(s.deviceApple.deviceId, deviceId))
          .limit(1);
        if (!apple?.token || !apple.pushMagic) return;
        const [certificate] = yield* db
          .select()
          .from(s.applePushCertificate)
          .where(eq(s.applePushCertificate.organizationId, organizationId))
          .limit(1);
        if (!certificate?.encryptedKey) return;

        const jwk = JSON.parse(
          yield* Effect.tryPromise({
            try: () => openSecret(authSecret, certificate.encryptedKey!),
            catch: () => new Error("Failed to decrypt the APNs private key"),
          }),
        ) as JsonWebKey;
        const key = yield* Effect.tryPromise({
          try: () => importPrivateKeyJwk(jwk),
          catch: () => new Error("Failed to import the APNs private key"),
        });
        const pkcs8 = yield* Effect.tryPromise({
          try: () => crypto.subtle.exportKey("pkcs8", key),
          catch: () => new Error("Failed to export the APNs private key"),
        });
        yield* apns.push({
          pushToken: apple.token,
          pushMagic: apple.pushMagic,
          topic: apple.topic ?? certificate.topic,
          certPem: certificate.certPem,
          privateKeyPem: pemEncode("PRIVATE KEY", pkcs8),
        });
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning(`Failed to send post-enrollment APNs push: ${String(error)}`),
        ),
      );

    const requireDevice = (scope: CheckinScope) =>
      findDeviceByScope(scope).pipe(
        Effect.flatMap((device) =>
          device ? Effect.succeed(device) : Effect.fail(new UnknownDevice()),
        ),
        Effect.mapError((cause) => (cause instanceof UnknownDevice ? cause : internal(cause))),
      );

    return ManagementBackend.of({
      appleDeviceEvent: (scope: CheckinScope, event: AppleDeviceEvent) =>
        provideDb(
          Effect.gen(function* () {
            return yield* Effect.gen(function* () {
              if (event._tag === "Authenticate") {
                const organizationId = certificateOu(scope.identityCertificate);
                if (!organizationId) return yield* Effect.fail(new UnknownDevice());
                const [organization] = yield* db
                  .select()
                  .from(s.organization)
                  .where(eq(s.organization.id, organizationId))
                  .limit(1);
                if (!organization) return yield* Effect.fail(new UnknownDevice());

                const [existing] = yield* db
                  .select()
                  .from(s.device)
                  .where(
                    and(
                      eq(s.device.organizationId, organizationId),
                      eq(s.device.dmIdentifier, scope.udid),
                    ),
                  )
                  .limit(1);
                const deviceId = existing?.id ?? id();
                const common = {
                  organizationId,
                  proto: "apple" as const,
                  status: "enrolling" as const,
                  name: event.serialNumber ?? event.model ?? scope.udid,
                  model: event.model ?? null,
                  serial: event.serialNumber ?? null,
                  osVersion: event.osVersion ?? null,
                  vendor: "Apple",
                  physicalName: event.serialNumber ?? event.model ?? scope.udid,
                  dmIdentifier: scope.udid,
                  dmCertHash: yield* Effect.promise(() => certHash(scope.identityCertificate)),
                  lastSeenAt: now(),
                };
                if (existing) {
                  yield* db.update(s.device).set(common).where(eq(s.device.id, deviceId));
                } else {
                  yield* db.insert(s.device).values({ id: deviceId, enrolledAt: now(), ...common });
                }
                yield* db
                  .insert(s.deviceApple)
                  .values({
                    deviceId,
                    token: null,
                    pushMagic: null,
                    topic: null,
                    unlockToken: null,
                    deviceToken: id() + id(),
                    tokenUpdatedAt: null,
                  })
                  .onDuplicateKeyUpdate({
                    set: {
                      token: null,
                      pushMagic: null,
                      topic: null,
                      unlockToken: null,
                      deviceToken: id() + id(),
                      tokenUpdatedAt: null,
                    },
                  });
                return;
              }

              const device = yield* findDeviceByScope(scope);
              if (!device) return yield* Effect.fail(new UnknownDevice());

              if (event._tag === "TokenUpdate") {
                yield* db
                  .update(s.deviceApple)
                  .set({
                    token: event.pushToken,
                    pushMagic: event.pushMagic,
                    topic: event.topic,
                    tokenUpdatedAt: now(),
                  })
                  .where(eq(s.deviceApple.deviceId, device.id));
                if (event.channel === "device" && device.status === "enrolling") {
                  yield* db
                    .update(s.device)
                    .set({ status: "enrolled", lastSeenAt: now() })
                    .where(eq(s.device.id, device.id));
                  yield* pushEnrolledDevice(device.id, device.organizationId);
                }
                return;
              }

              if (event._tag === "CheckOut") {
                yield* db
                  .update(s.device)
                  .set({ status: "unenrolled", lastSeenAt: now() })
                  .where(eq(s.device.id, device.id));
                yield* db
                  .update(s.deviceApple)
                  .set({
                    token: null,
                    pushMagic: null,
                    topic: null,
                    unlockToken: null,
                    tokenUpdatedAt: null,
                  })
                  .where(eq(s.deviceApple.deviceId, device.id));
                return;
              }

              if (event._tag === "CommandResult") {
                yield* db
                  .update(s.deviceCommand)
                  .set({
                    status: event.status === "Acknowledged" ? "succeeded" : "failed",
                    resultStatus: event.status,
                    resultDetail: event.errorDetail ?? null,
                    updatedAt: now(),
                  })
                  .where(
                    and(
                      eq(s.deviceCommand.id, event.commandUUID),
                      eq(s.deviceCommand.deviceId, device.id),
                    ),
                  );
                yield* db
                  .update(s.device)
                  .set({ lastSeenAt: now() })
                  .where(eq(s.device.id, device.id));
                return;
              }

              if (event._tag === "DeclarationStatus") {
                yield* updateInventoryFromStatus(device.id, event.statusItems);
                return;
              }

              yield* db
                .update(s.device)
                .set({ lastSeenAt: now() })
                .where(eq(s.device.id, device.id));
            }).pipe(
              Effect.mapError((cause) =>
                cause instanceof UnknownDevice ? cause : internal(cause),
              ),
            );
          }),
        ),

      appleManagementCheckin: (
        scope: CheckinScope,
      ): Effect.Effect<
        ManagementManifest,
        UnknownDevice | ServerInitiatedUnenrollment | InternalServerError
      > =>
        provideDb(
          Effect.gen(function* () {
            const device = yield* requireDevice(scope);
            if (device.status === "unenrolling")
              return yield* Effect.fail(new ServerInitiatedUnenrollment());
            if (device.status !== "enrolled") return { _tag: "Idle" as const };
            const [command] = yield* db
              .select()
              .from(s.deviceCommand)
              .where(
                and(eq(s.deviceCommand.deviceId, device.id), eq(s.deviceCommand.status, "queued")),
              )
              .orderBy(s.deviceCommand.createdAt)
              .limit(1);
            if (command) {
              yield* db
                .update(s.deviceCommand)
                .set({ status: "sent", updatedAt: now() })
                .where(eq(s.deviceCommand.id, command.id));
              return {
                _tag: "Command" as const,
                commandUUID: command.id,
                requestType: command.requestType,
                payload: command.payload ?? {},
              };
            }
            const deviceToken = yield* deviceTokenFor(device.id);
            const items = yield* declarationItemsForDevice(device.id, deviceToken, {
              origin,
              authSecret: authSecret ?? "",
            }).pipe(Effect.mapError(internal));
            const token = yield* Effect.tryPromise({
              try: () =>
                hashToken(
                  [
                    ...items.activations,
                    ...items.configurations,
                    ...items.assets,
                    ...items.management,
                  ].map((item) => `${item.identifier}_MTTX_${item.serverToken}`),
                ),
              catch: internal,
            });
            return { _tag: "DdmSync" as const, serverToken: token };
          }).pipe(
            Effect.mapError((cause) =>
              cause instanceof UnknownDevice || cause instanceof ServerInitiatedUnenrollment
                ? cause
                : internal(cause),
            ),
          ),
        ),

      getAppleDeclarationTokens: (
        scope: CheckinScope,
      ): Effect.Effect<DdmTokens, UnknownDevice | InternalServerError> =>
        provideDb(
          Effect.gen(function* () {
            const device = yield* requireDevice(scope);
            const deviceToken = yield* deviceTokenFor(device.id);
            const items = yield* declarationItemsForDevice(device.id, deviceToken, {
              origin,
              authSecret: authSecret ?? "",
            }).pipe(Effect.mapError(internal));
            const categoryToken = (category: keyof DdmDeclarationItems) =>
              hashToken(
                items[category].map((item) => `${item.identifier}_MTTX_${item.serverToken}`),
              );
            return yield* Effect.tryPromise({
              try: async () => ({
                activationsToken: await categoryToken("activations"),
                configurationsToken: await categoryToken("configurations"),
                assetsToken: await categoryToken("assets"),
                managementToken: await categoryToken("management"),
              }),
              catch: internal,
            });
          }),
        ),

      getAppleDeclarationItems: (
        scope: CheckinScope,
      ): Effect.Effect<DdmDeclarationItems, UnknownDevice | InternalServerError> =>
        provideDb(
          Effect.gen(function* () {
            const device = yield* requireDevice(scope);
            const deviceToken = yield* deviceTokenFor(device.id);
            return yield* declarationItemsForDevice(device.id, deviceToken, {
              origin,
              authSecret: authSecret ?? "",
            }).pipe(Effect.mapError(internal));
          }),
        ),

      getAppleDeclaration: (scope: CheckinScope, type: string, identifier: string) =>
        provideDb(
          Effect.gen(function* () {
            const device = yield* requireDevice(scope);
            const deviceToken = yield* deviceTokenFor(device.id);
            const context: DeclarationContext = {
              origin,
              authSecret: authSecret ?? "",
              deviceToken,
            };
            if (type === "activation" && identifier === DEVICE_INFORMATION_ACTIVATION_ID) {
              return {
                Type: "com.apple.activation.simple",
                Identifier: DEVICE_INFORMATION_ACTIVATION_ID,
                ServerToken: DEVICE_INFORMATION_ACTIVATION_SERVER_TOKEN,
                Payload: { StandardConfigurations: [DEVICE_INFORMATION_CONFIGURATION_ID] },
              };
            }
            if (type === "activation") {
              const rows = (yield* scopedConfigurations(device.id).pipe(
                Effect.mapError(internal),
              )) as Array<ScopedConfiguration>;
              const configurations = rows
                .filter((row) => row.groupId === identifier)
                .map((row) => configurationDeclarationIdentifier(row.policyId, row.kind));
              if (configurations.length === 0) return null;
              return {
                Type: "com.apple.activation.simple",
                Identifier: identifier,
                ServerToken: yield* Effect.tryPromise({
                  try: () => hashToken(configurations),
                  catch: internal,
                }),
                Payload: { StandardConfigurations: configurations },
              };
            }
            if (type === "configuration" && identifier === DEVICE_INFORMATION_CONFIGURATION_ID) {
              return {
                Type: "com.apple.configuration.management.status-subscriptions",
                Identifier: DEVICE_INFORMATION_CONFIGURATION_ID,
                ServerToken: DEVICE_INFORMATION_CONFIGURATION_SERVER_TOKEN,
                Payload: { StatusItems: DEVICE_INFORMATION_STATUS_ITEMS.map((Name) => ({ Name })) },
              };
            }
            if (type === "configuration") {
              const { policyId, kind } = splitConfigurationDeclarationIdentifier(identifier);
              const rows = (yield* scopedConfigurations(device.id).pipe(
                Effect.mapError(internal),
              )) as Array<ScopedConfiguration>;
              const row = rows.find((item) => item.policyId === policyId && item.kind === kind);
              if (!row) return null;
              return yield* Effect.tryPromise({
                try: () => buildConfigurationDeclaration(row, context),
                catch: internal,
              });
            }
            if (type === "asset") {
              const parsed = splitConfigurationAssetIdentifier(identifier);
              if (!parsed) return null;
              const rows = (yield* scopedConfigurations(device.id).pipe(
                Effect.mapError(internal),
              )) as Array<ScopedConfiguration>;
              const row = rows.find(
                (item) => item.policyId === parsed.policyId && item.kind === parsed.kind,
              );
              if (!row || !isCertificateKind(row.kind)) return null;
              return yield* Effect.tryPromise({
                try: () => buildAssetDeclaration(row, context),
                catch: internal,
              });
            }
            if (type === "management" && identifier === MANAGEMENT_DECLARATION_ID) {
              const [organization] = yield* db
                .select()
                .from(s.organization)
                .where(eq(s.organization.id, device.organizationId))
                .limit(1)
                .pipe(Effect.mapError(internal));
              return {
                Type: "com.apple.management.organization-info",
                Identifier: MANAGEMENT_DECLARATION_ID,
                ServerToken: MANAGEMENT_DECLARATION_SERVER_TOKEN,
                Payload: {
                  Email: "hello@mattrax.app",
                  Name: organization?.name ?? "Mattrax",
                  URL: origin,
                },
              };
            }
            return null;
          }),
        ),

      getAppleAsset: (identityCertificate, identifier, token) =>
        provideDb(
          Effect.gen(function* () {
            const parsed = splitConfigurationAssetIdentifier(identifier);
            if (!parsed) return null;
            const [row] = (yield* db
              .select()
              .from(s.configuration)
              .innerJoin(s.policy, eq(s.policy.id, s.configuration.policyId))
              .where(
                and(
                  eq(s.configuration.policyId, parsed.policyId),
                  eq(s.configuration.kind, parsed.kind),
                ),
              )
              .limit(1)
              .pipe(Effect.mapError(internal))) as Array<{
              configuration: typeof s.configuration.$inferSelect;
              policy: typeof s.policy.$inferSelect;
            }>;
            if (!row || !isCertificateKind(row.configuration.kind)) return null;

            const configRow: PolicyConfigurationRow = {
              policyId: row.configuration.policyId,
              kind: row.configuration.kind,
              data: row.configuration.data,
              hash: row.configuration.hash,
              organizationId: row.policy.organizationId,
            };

            // Tenant-scoped: either the device presents an identity
            // certificate from the owning tenant, or the DDM asset URL carries
            // a valid signature.
            const tenantAllowed =
              identityCertificate !== undefined &&
              certificateAllowsOrganization(identityCertificate, row.policy.organizationId);
            const tokenAllowed = yield* Effect.tryPromise({
              try: () => verifyAssetRequestToken(authSecret ?? "", token, configRow),
              catch: internal,
            });
            if (!tenantAllowed && !tokenAllowed) return null;

            return buildAssetContent(configRow);
          }),
        ),

      getAppleProfile: (policyId, kind) =>
        provideDb(
          Effect.gen(function* () {
            const [row] = (yield* db
              .select()
              .from(s.configuration)
              .where(and(eq(s.configuration.policyId, policyId), eq(s.configuration.kind, kind)))
              .limit(1)
              .pipe(Effect.mapError(internal))) as Array<typeof s.configuration.$inferSelect>;
            if (!row) return null;
            const parsed = parseConfigurationKind(row.kind);
            if (parsed.type !== "device" && parsed.type !== "custom") return null;
            return yield* Effect.tryPromise({
              try: () =>
                buildLegacyProfile({
                  policyId: row.policyId,
                  kind: row.kind,
                  data: row.data,
                  hash: row.hash,
                }),
              catch: internal,
            });
          }),
        ),

      ...makeWindowsBackend({
        db,
        origin,
        authSecret,
        windowsOrganizationId: options.windowsOrganizationId,
      }),
    });
  };

  static readonly layer = (
    origin: string,
    options?: {
      readonly apns?: ApnsService.Service;
      readonly authSecret?: string;
      readonly windowsOrganizationId?: string;
    },
  ) =>
    Layer.effect(
      ManagementBackend,
      Effect.gen(function* () {
        const db = yield* Db;
        return ManagementBackendEnterpriseLive.make({ db, origin, ...options });
      }),
    );
}

export const enterpriseEnrollmentProfile = (config: {
  origin: string;
  topic: string;
  organizationId: string;
  organizationName?: string;
  challenge?: string;
  displayName?: string;
  identifier?: string;
}) =>
  buildAppleEnrollmentProfile({
    origin: config.origin,
    topic: config.topic,
    organizationId: config.organizationId,
    organizationName: config.organizationName ?? "Mattrax",
    challenge: config.challenge ?? crypto.randomUUID(),
    displayName: config.displayName,
    identifier: config.identifier,
  });

export const policyHash = jsonHash;
export { createScepChallenge, verifyScepChallenge } from "@mattrax/scep";
export { ScepRepositoryLive } from "./scep.ts";
export * from "./policy.ts";
export * from "./windows.ts";
