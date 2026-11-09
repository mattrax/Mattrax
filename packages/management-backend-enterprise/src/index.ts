import { Effect, Layer } from "effect";
import { and, eq } from "drizzle-orm";
import { Db, schema as s } from "@mattrax/enterprise-core";
import {
  InternalServerError,
  ManagementBackend,
  ManagementNotSupported,
  ServerInitiatedUnenrollment,
  UnknownDevice,
  type AppleDeviceEvent,
  type CheckinScope,
  type DdmDeclarationItems,
  type DdmTokens,
  type ManagementManifest,
} from "@mattrax/management-backend";

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

const declarationIdentifier = (policyId: string, kind: string) => `${policyId}:${kind}`;
type DeviceRow = typeof s.device.$inferSelect;

const splitDeclarationIdentifier = (identifier: string) => {
  const [policyId, ...rest] = identifier.split(":");
  return { policyId, kind: rest.join(":") };
};

const declarationType = (kind: string) =>
  kind.startsWith("com.apple.") ? kind : `com.apple.configuration.${kind}`;

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
        groupId: s.groupDevice.groupId,
      })
      .from(s.configuration)
      .innerJoin(s.groupPolicy, eq(s.groupPolicy.policyId, s.configuration.policyId))
      .innerJoin(s.groupDevice, eq(s.groupDevice.groupId, s.groupPolicy.groupId))
      .where(eq(s.groupDevice.deviceId, deviceId));
  });

const declarationItemsForDevice = (
  deviceId: string,
): Effect.Effect<DdmDeclarationItems, unknown, Db> =>
  Effect.gen(function* () {
    const rows = yield* scopedConfigurations(deviceId) as Effect.Effect<
      Array<{ kind: string; policyId: string; hash: string; groupId: string }>,
      unknown,
      Db
    >;
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
          hashToken(configurations.map((row) => declarationIdentifier(row.policyId, row.kind))),
        ),
      });
    }

    const uniqueConfigurations = new Map<
      string,
      { kind: string; policyId: string; hash: string }
    >();
    for (const row of rows)
      uniqueConfigurations.set(declarationIdentifier(row.policyId, row.kind), row);

    return {
      activations,
      configurations: [
        {
          identifier: DEVICE_INFORMATION_CONFIGURATION_ID,
          serverToken: DEVICE_INFORMATION_CONFIGURATION_SERVER_TOKEN,
        },
        ...[...uniqueConfigurations].map(([identifier, row]) => ({
          identifier,
          serverToken: row.hash,
        })),
      ],
      assets: [],
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
  }): ManagementBackend.Service => {
    const { db, origin } = options;
    const provideDb = <A, E>(effect: Effect.Effect<A, E, Db>) =>
      effect.pipe(Effect.provideService(Db, db));
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
                  .onConflictDoUpdate({
                    target: s.deviceApple.deviceId,
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
            if (device.status !== "enrolled") return { _tag: "Idle" };
            const items = yield* declarationItemsForDevice(device.id).pipe(
              Effect.mapError(internal),
            );
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
            return { _tag: "DdmSync", serverToken: token };
          }),
        ),

      getAppleDeclarationTokens: (
        scope: CheckinScope,
      ): Effect.Effect<DdmTokens, UnknownDevice | InternalServerError> =>
        provideDb(
          Effect.gen(function* () {
            const device = yield* requireDevice(scope);
            const items = yield* declarationItemsForDevice(device.id).pipe(
              Effect.mapError(internal),
            );
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
            return yield* declarationItemsForDevice(device.id).pipe(Effect.mapError(internal));
          }),
        ),

      getAppleDeclaration: (scope: CheckinScope, type: string, identifier: string) =>
        provideDb(
          Effect.gen(function* () {
            const device = yield* requireDevice(scope);
            if (type === "activation" && identifier === DEVICE_INFORMATION_ACTIVATION_ID) {
              return {
                Type: "com.apple.activation.simple",
                Identifier: DEVICE_INFORMATION_ACTIVATION_ID,
                ServerToken: DEVICE_INFORMATION_ACTIVATION_SERVER_TOKEN,
                Payload: { StandardConfigurations: [DEVICE_INFORMATION_CONFIGURATION_ID] },
              };
            }
            if (type === "activation") {
              const rows = yield* scopedConfigurations(device.id).pipe(
                Effect.mapError(internal),
              ) as Effect.Effect<
                Array<{ groupId: string; kind: string; policyId: string }>,
                InternalServerError,
                Db
              >;
              const configurations = rows
                .filter((row) => row.groupId === identifier)
                .map((row) => declarationIdentifier(row.policyId, row.kind));
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
              const { policyId, kind } = splitDeclarationIdentifier(identifier);
              const rows = yield* scopedConfigurations(device.id).pipe(
                Effect.mapError(internal),
              ) as Effect.Effect<
                Array<{ policyId: string; kind: string; data: unknown; hash: string }>,
                InternalServerError,
                Db
              >;
              const row = rows.find((item) => item.policyId === policyId && item.kind === kind);
              if (!row) return null;
              return {
                Type: declarationType(row.kind),
                Identifier: identifier,
                ServerToken: row.hash,
                Payload: row.data,
              };
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

      getAppleAsset: (_identityCertificate, _identifier) => Effect.succeed(null),

      windowsDiscovery: () => Effect.fail(new ManagementNotSupported()),
      getWindowsEnrollmentPolicy: () => Effect.fail(new ManagementNotSupported()),
      windowsEnroll: () => Effect.fail(new ManagementNotSupported()),
      windowsManagementCheckin: () => Effect.fail(new ManagementNotSupported()),
      windowsDeviceEvent: () => Effect.fail(new ManagementNotSupported()),
    });
  };

  static readonly layer = (origin: string) =>
    Layer.effect(
      ManagementBackend,
      Effect.gen(function* () {
        const db = yield* Db;
        return ManagementBackendEnterpriseLive.make({ db, origin });
      }),
    );
}

export const enterpriseEnrollmentProfile = (config: {
  origin: string;
  topic: string;
  organizationId: string;
}) => {
  const scepUuid = crypto.randomUUID();
  const mdmUuid = crypto.randomUUID();
  const topUuid = crypto.randomUUID();
  return {
    PayloadContent: [
      {
        PayloadContent: {
          Challenge: "mattrax-scep-challenge",
          "Key Type": "RSA",
          "Key Usage": 5,
          Keysize: 2048,
          Subject: [
            [["O", "Mattrax"]],
            [["OU", config.organizationId]],
            [["CN", "Mattrax Identity"]],
          ],
          URL: `${config.origin}/mdm/apple/scep`,
        },
        PayloadIdentifier: "com.mattrax.scep",
        PayloadType: "com.apple.security.scep",
        PayloadUUID: scepUuid,
        PayloadVersion: 1,
      },
      {
        AccessRights: 8191,
        CheckInURL: `${config.origin}/mdm/apple/mdm`,
        CheckOutWhenRemoved: true,
        IdentityCertificateUUID: scepUuid,
        PayloadIdentifier: "com.mattrax.mdm",
        PayloadType: "com.apple.mdm",
        PayloadUUID: mdmUuid,
        PayloadVersion: 1,
        ServerCapabilities: ["com.apple.mdm.per-user-connections", "com.apple.mdm.bootstraptoken"],
        ServerURL: `${config.origin}/mdm/apple/mdm`,
        SignMessage: true,
        Topic: config.topic,
      },
    ],
    PayloadDisplayName: "Mattrax Enrollment",
    PayloadIdentifier: "com.mattrax.enrollment",
    PayloadOrganization: "Mattrax",
    PayloadType: "Configuration",
    PayloadUUID: topUuid,
    PayloadVersion: 1,
  };
};

export const policyHash = jsonHash;
export { ScepRepositoryLive } from "./scep.ts";
