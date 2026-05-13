import { Effect, Layer } from "effect";
import { and, eq } from "drizzle-orm";
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

type EnterpriseManagementSchema = {
  readonly organization: any;
  readonly device: any;
  readonly deviceApple: any;
  readonly enterpriseGroup: any;
  readonly groupDevice: any;
  readonly groupPolicy: any;
  readonly policy: any;
  readonly configuration: any;
};

type EnterpriseManagementDb = {
  readonly query: any;
  readonly select: (...args: Array<any>) => any;
  readonly insert: (table: any) => any;
  readonly update: (table: any) => any;
  readonly delete: (table: any) => any;
};

export type EnterpriseManagementBackendConfig = {
  readonly origin: string;
  readonly schema: EnterpriseManagementSchema;
};

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
const runDb = (effect: Effect.Effect<unknown, unknown, never>): Promise<any> => Effect.runPromise(effect);

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
  return text.match(/(?:^|[,/\n])\s*OU\s*=\s*([^,\/\n]+)/i)?.[1]?.trim() ?? null;
};

const certHash = async (identityCertificate: string | undefined) => {
  if (!identityCertificate) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identityCertificate));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const hashToken = async (parts: Iterable<string>) => {
  const sorted = [...parts].sort();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sorted.join("|")));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
};

const jsonHash = async (value: unknown) => hashToken([JSON.stringify(value)]);

const declarationIdentifier = (policyId: string, kind: string) => `${policyId}:${kind}`;

const splitDeclarationIdentifier = (identifier: string) => {
  const [policyId, ...rest] = identifier.split(":");
  return { policyId, kind: rest.join(":") };
};

const declarationType = (kind: string) => kind.startsWith("com.apple.") ? kind : `com.apple.configuration.${kind}`;

const findDeviceByScope = async (db: EnterpriseManagementDb, s: EnterpriseManagementSchema, scope: CheckinScope) => {
  const byUdid = await runDb(db.query.device.findFirst({ where: eq(s.device.dmIdentifier, scope.udid) }));
  if (byUdid) return byUdid;
  return null;
};

const scopedConfigurations = async (db: EnterpriseManagementDb, s: EnterpriseManagementSchema, deviceId: string) =>
  runDb(db.select({
    kind: s.configuration.kind,
    policyId: s.configuration.policyId,
    data: s.configuration.data,
    hash: s.configuration.hash,
    groupId: s.groupDevice.groupId,
  })
    .from(s.configuration)
    .innerJoin(s.groupPolicy, eq(s.groupPolicy.policyId, s.configuration.policyId))
    .innerJoin(s.groupDevice, eq(s.groupDevice.groupId, s.groupPolicy.groupId))
    .where(eq(s.groupDevice.deviceId, deviceId)));

const declarationItemsForDevice = async (db: EnterpriseManagementDb, s: EnterpriseManagementSchema, deviceId: string): Promise<DdmDeclarationItems> => {
  const rows = await scopedConfigurations(db, s, deviceId) as Array<{ kind: string; policyId: string; hash: string; groupId: string }>;
  const groups = new Map<string, Array<{ kind: string; policyId: string }>>();
  for (const row of rows) {
    const group = groups.get(row.groupId) ?? [];
    group.push(row);
    groups.set(row.groupId, group);
  }

  const activations = [{ identifier: DEVICE_INFORMATION_ACTIVATION_ID, serverToken: DEVICE_INFORMATION_ACTIVATION_SERVER_TOKEN }];
  for (const [groupId, configurations] of groups) {
    activations.push({
      identifier: groupId,
      serverToken: await hashToken(configurations.map((row) => declarationIdentifier(row.policyId, row.kind))),
    });
  }

  const uniqueConfigurations = new Map<string, { kind: string; policyId: string; hash: string }>();
  for (const row of rows) uniqueConfigurations.set(declarationIdentifier(row.policyId, row.kind), row);

  return {
    activations,
    configurations: [
      { identifier: DEVICE_INFORMATION_CONFIGURATION_ID, serverToken: DEVICE_INFORMATION_CONFIGURATION_SERVER_TOKEN },
      ...[...uniqueConfigurations].map(([identifier, row]) => ({ identifier, serverToken: row.hash })),
    ],
    assets: [],
    management: [{ identifier: MANAGEMENT_DECLARATION_ID, serverToken: MANAGEMENT_DECLARATION_SERVER_TOKEN }],
  };
};

const updateInventoryFromStatus = async (db: EnterpriseManagementDb, s: EnterpriseManagementSchema, deviceId: string, statusItems: unknown) => {
  if (!statusItems || typeof statusItems !== "object") return;
  const root = statusItems as Record<string, any>;
  const device = root.device;
  const update: Record<string, unknown> = { lastSeenAt: now() };
  if (device?.identifier?.["serial-number"]) update.serial = device.identifier["serial-number"];
  if (device?.model?.["marketing-name"]) update.model = device.model["marketing-name"];
  if (device?.model?.identifier) update.modelIdentifier = device.model.identifier;
  if (device?.["operating-system"]?.["marketing-name"]) update.osEdition = device["operating-system"]["marketing-name"];
  if (device?.["operating-system"]?.version) update.osVersion = device["operating-system"].version;
  if (device?.["operating-system"]?.["build-version"]) update.osBuild = device["operating-system"]["build-version"];
  await runDb(db.update(s.device).set(update).where(eq(s.device.id, deviceId)));
};

export const ManagementBackendEnterpriseLive = (db: EnterpriseManagementDb, config: EnterpriseManagementBackendConfig) => {
  const s = config.schema;

  const requireDevice = (scope: CheckinScope) => Effect.tryPromise({
    try: async () => {
      const device = await findDeviceByScope(db, s, scope);
      if (!device) throw new UnknownDevice();
      return device;
    },
    catch: (cause) => cause instanceof UnknownDevice ? cause : internal(cause),
  });

  return Layer.succeed(ManagementBackend, ManagementBackend.of({
    appleDeviceEvent: (scope: CheckinScope, event: AppleDeviceEvent) => Effect.tryPromise({
      try: async () => {
        if (event._tag === "Authenticate") {
          const organizationId = certificateOu(scope.identityCertificate);
          if (!organizationId) throw new UnknownDevice();
          const organization = await runDb(db.query.organization.findFirst({ where: eq(s.organization.id, organizationId) }));
          if (!organization) throw new UnknownDevice();

          const existing = await runDb(db.query.device.findFirst({ where: and(eq(s.device.organizationId, organizationId), eq(s.device.dmIdentifier, scope.udid)) }));
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
            dmCertHash: await certHash(scope.identityCertificate),
            lastSeenAt: now(),
          };
          if (existing) {
            await runDb(db.update(s.device).set(common).where(eq(s.device.id, deviceId)));
          } else {
            await runDb(db.insert(s.device).values({ id: deviceId, enrolledAt: now(), ...common }));
          }
          await runDb(db.insert(s.deviceApple).values({
            deviceId,
            token: null,
            pushMagic: null,
            topic: null,
            unlockToken: null,
            deviceToken: id() + id(),
            tokenUpdatedAt: null,
          }).onConflictDoUpdate({
            target: s.deviceApple.deviceId,
            set: { token: null, pushMagic: null, topic: null, unlockToken: null, deviceToken: id() + id(), tokenUpdatedAt: null },
          }));
          return;
        }

        const device = await findDeviceByScope(db, s, scope);
        if (!device) throw new UnknownDevice();

        if (event._tag === "TokenUpdate") {
          await runDb(db.update(s.deviceApple).set({
            token: event.pushToken,
            pushMagic: event.pushMagic,
            topic: event.topic,
            tokenUpdatedAt: now(),
          }).where(eq(s.deviceApple.deviceId, device.id)));
          if (event.channel === "device" && device.status === "enrolling") {
            await runDb(db.update(s.device).set({ status: "enrolled", lastSeenAt: now() }).where(eq(s.device.id, device.id)));
          }
          return;
        }

        if (event._tag === "CheckOut") {
          await runDb(db.update(s.device).set({ status: "unenrolled", lastSeenAt: now() }).where(eq(s.device.id, device.id)));
          await runDb(db.update(s.deviceApple).set({ token: null, pushMagic: null, topic: null, unlockToken: null, tokenUpdatedAt: null }).where(eq(s.deviceApple.deviceId, device.id)));
          return;
        }

        if (event._tag === "DeclarationStatus") {
          await updateInventoryFromStatus(db, s, device.id, event.statusItems);
          return;
        }

        await runDb(db.update(s.device).set({ lastSeenAt: now() }).where(eq(s.device.id, device.id)));
      },
      catch: (cause) => cause instanceof UnknownDevice ? cause : internal(cause),
    }),

    appleManagementCheckin: (scope: CheckinScope): Effect.Effect<ManagementManifest, UnknownDevice | ServerInitiatedUnenrollment | InternalServerError> => Effect.gen(function* () {
      const device = yield* requireDevice(scope);
      if (device.status === "unenrolling") return yield* Effect.fail(new ServerInitiatedUnenrollment());
      if (device.status !== "enrolled") return { _tag: "Idle" };
      const items = yield* Effect.tryPromise({ try: () => declarationItemsForDevice(db, s, device.id), catch: internal });
      const token = yield* Effect.tryPromise({
        try: () => hashToken([...items.activations, ...items.configurations, ...items.assets, ...items.management].map((item) => `${item.identifier}_MTTX_${item.serverToken}`)),
        catch: internal,
      });
      return { _tag: "DdmSync", serverToken: token };
    }),

    getAppleDeclarationTokens: (scope: CheckinScope): Effect.Effect<DdmTokens, UnknownDevice | InternalServerError> => Effect.gen(function* () {
      const device = yield* requireDevice(scope);
      const items = yield* Effect.tryPromise({ try: () => declarationItemsForDevice(db, s, device.id), catch: internal });
      const categoryToken = (category: keyof DdmDeclarationItems) => hashToken(items[category].map((item) => `${item.identifier}_MTTX_${item.serverToken}`));
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

    getAppleDeclarationItems: (scope: CheckinScope): Effect.Effect<DdmDeclarationItems, UnknownDevice | InternalServerError> => Effect.gen(function* () {
      const device = yield* requireDevice(scope);
      return yield* Effect.tryPromise({ try: () => declarationItemsForDevice(db, s, device.id), catch: internal });
    }),

    getAppleDeclaration: (scope: CheckinScope, type: string, identifier: string) => Effect.gen(function* () {
      const device = yield* requireDevice(scope);
      return yield* Effect.tryPromise({
        try: async () => {
          if (type === "activation" && identifier === DEVICE_INFORMATION_ACTIVATION_ID) {
            return {
              Type: "com.apple.activation.simple",
              Identifier: DEVICE_INFORMATION_ACTIVATION_ID,
              ServerToken: DEVICE_INFORMATION_ACTIVATION_SERVER_TOKEN,
              Payload: { StandardConfigurations: [DEVICE_INFORMATION_CONFIGURATION_ID] },
            };
          }
          if (type === "activation") {
            const rows = await scopedConfigurations(db, s, device.id) as Array<{ groupId: string; kind: string; policyId: string }>;
            const configurations = rows.filter((row) => row.groupId === identifier).map((row) => declarationIdentifier(row.policyId, row.kind));
            if (configurations.length === 0) return null;
            return {
              Type: "com.apple.activation.simple",
              Identifier: identifier,
              ServerToken: await hashToken(configurations),
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
            const rows = await scopedConfigurations(db, s, device.id) as Array<{ policyId: string; kind: string; data: unknown; hash: string }>;
            const row = rows.find((item) => item.policyId === policyId && item.kind === kind);
            if (!row) return null;
            return { Type: declarationType(row.kind), Identifier: identifier, ServerToken: row.hash, Payload: row.data };
          }
          if (type === "management" && identifier === MANAGEMENT_DECLARATION_ID) {
            const organization = await runDb(db.query.organization.findFirst({ where: eq(s.organization.id, device.organizationId) }));
            return {
              Type: "com.apple.management.organization-info",
              Identifier: MANAGEMENT_DECLARATION_ID,
              ServerToken: MANAGEMENT_DECLARATION_SERVER_TOKEN,
              Payload: { Email: "hello@mattrax.app", Name: organization?.name ?? "Mattrax", URL: config.origin },
            };
          }
          return null;
        },
        catch: internal,
      });
    }),

    getAppleAsset: (_identityCertificate, _identifier) => Effect.succeed(null),

    windowsDiscovery: () => Effect.fail(new ManagementNotSupported()),
    getWindowsEnrollmentPolicy: () => Effect.fail(new ManagementNotSupported()),
    windowsEnroll: () => Effect.fail(new ManagementNotSupported()),
    windowsManagementCheckin: () => Effect.fail(new ManagementNotSupported()),
    windowsDeviceEvent: () => Effect.fail(new ManagementNotSupported()),
  }));
};

export const enterpriseEnrollmentProfile = (config: { origin: string; topic: string; organizationId: string }) => {
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
