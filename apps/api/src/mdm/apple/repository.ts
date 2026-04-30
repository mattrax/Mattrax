import { Context, Effect, Layer } from "effect";
import { eq, and, desc, asc } from "drizzle-orm";
import type { Database } from "../../db";
import * as dbSchema from "../../db/schema";
import {
  type AppleDevice,
  type MdmCommand,
  type Declaration,
  type DeviceDeclarationState,
  MdmError,
  DeclarationNotFound,
} from "./schema";

export class AppleMdmRepository extends Context.Service<
  AppleMdmRepository,
  {
    readonly upsertDevice: (device: AppleDevice) => Effect.Effect<void, MdmError>;
    readonly getDeviceByUdid: (udid: string) => Effect.Effect<AppleDevice | null, MdmError>;
    readonly getDeviceById: (id: string) => Effect.Effect<AppleDevice | null, MdmError>;
    readonly updateDeviceStatus: (id: string, status: AppleDevice["status"]) => Effect.Effect<void, MdmError>;
    readonly updateDeviceLastSeen: (id: string) => Effect.Effect<void, MdmError>;
    readonly updateDeviceDdmSupport: (id: string, supportsDdm: boolean) => Effect.Effect<void, MdmError>;

    readonly insertCommand: (command: MdmCommand) => Effect.Effect<void, MdmError>;
    readonly getPendingCommands: (deviceId: string) => Effect.Effect<MdmCommand[], MdmError>;
    readonly getNextPendingCommand: (deviceId: string) => Effect.Effect<MdmCommand | null, MdmError>;
    readonly updateCommandStatus: (id: string, status: MdmCommand["status"], detail?: string) => Effect.Effect<void, MdmError>;

    readonly insertDeclaration: (declaration: Declaration) => Effect.Effect<void, MdmError>;
    readonly deleteDeclaration: (id: string) => Effect.Effect<void, DeclarationNotFound | MdmError>;
    readonly getDeclarations: () => Effect.Effect<Declaration[], MdmError>;
    readonly getDeclarationById: (id: string) => Effect.Effect<Declaration | null, MdmError>;

    readonly upsertDeviceDeclaration: (state: DeviceDeclarationState) => Effect.Effect<void, MdmError>;
    readonly getDeviceDeclarations: (deviceId: string) => Effect.Effect<DeviceDeclarationState[], MdmError>;
    readonly updateDeviceDeclarationStatus: (deviceId: string, declarationId: string, status: DeviceDeclarationState["status"], detail?: string) => Effect.Effect<void, MdmError>;
  }
>()("AppleMdmRepository") {}

export const AppleMdmRepositoryLive = (db: Database) =>
  Layer.succeed(AppleMdmRepository)(
    AppleMdmRepository.of({
      upsertDevice: (device) =>
        Effect.tryPromise({
          try: async () => {
            const existing = await db.query.devices.findFirst({
              where: eq(dbSchema.devices.id, device.id),
            });
            if (existing) {
              await db.update(dbSchema.devices).set({
                udid: device.udid,
                serialNumber: device.serialNumber ?? null,
                model: device.model ?? null,
                osVersion: device.osVersion ?? null,
                supportsDdm: device.supportsDdm,
                pushToken: device.pushToken ?? null,
                pushMagic: device.pushMagic ?? null,
                topic: device.topic ?? null,
                channel: device.channel,
                status: device.status,
                lastSeenAt: device.lastSeenAt,
                identityCertPem: device.identityCertPem ?? null,
              }).where(eq(dbSchema.devices.id, device.id));
            } else {
              await db.insert(dbSchema.devices).values({
                id: device.id,
                udid: device.udid,
                serialNumber: device.serialNumber ?? null,
                model: device.model ?? null,
                osVersion: device.osVersion ?? null,
                supportsDdm: device.supportsDdm,
                pushToken: device.pushToken ?? null,
                pushMagic: device.pushMagic ?? null,
                topic: device.topic ?? null,
                channel: device.channel,
                status: device.status,
                enrolledAt: device.enrolledAt,
                lastSeenAt: device.lastSeenAt,
                identityCertPem: device.identityCertPem ?? null,
              });
            }
          },
          catch: (cause) => new MdmError({ message: "Failed to upsert device", cause }),
        }),

      getDeviceByUdid: (udid) =>
        Effect.tryPromise({
          try: async () => {
            const row = await db.query.devices.findFirst({
              where: eq(dbSchema.devices.udid, udid),
            });
            return row ? mapDevice(row) : null;
          },
          catch: (cause) => new MdmError({ message: "Failed to get device by UDID", cause }),
        }),

      getDeviceById: (id) =>
        Effect.tryPromise({
          try: async () => {
            const row = await db.query.devices.findFirst({
              where: eq(dbSchema.devices.id, id),
            });
            return row ? mapDevice(row) : null;
          },
          catch: (cause) => new MdmError({ message: "Failed to get device by ID", cause }),
        }),

      updateDeviceStatus: (id, status) =>
        Effect.tryPromise({
          try: async () => {
            await db.update(dbSchema.devices).set({ status }).where(eq(dbSchema.devices.id, id));
          },
          catch: (cause) => new MdmError({ message: "Failed to update device status", cause }),
        }),

      updateDeviceLastSeen: (id) =>
        Effect.tryPromise({
          try: async () => {
            await db.update(dbSchema.devices).set({ lastSeenAt: new Date() }).where(eq(dbSchema.devices.id, id));
          },
          catch: (cause) => new MdmError({ message: "Failed to update last seen", cause }),
        }),

      updateDeviceDdmSupport: (id, supportsDdm) =>
        Effect.tryPromise({
          try: async () => {
            await db.update(dbSchema.devices).set({ supportsDdm }).where(eq(dbSchema.devices.id, id));
          },
          catch: (cause) => new MdmError({ message: "Failed to update DDM support", cause }),
        }),

      insertCommand: (command) =>
        Effect.tryPromise({
          try: async () => {
            await db.insert(dbSchema.commands).values({
              id: command.id,
              deviceId: command.deviceId,
              requestType: command.requestType,
              payload: command.payload as any,
              status: command.status,
              resultDetail: command.resultDetail ?? null,
              priority: command.priority,
              createdAt: command.createdAt,
              sentAt: command.sentAt ?? null,
            });
          },
          catch: (cause) => new MdmError({ message: "Failed to insert command", cause }),
        }),

      getPendingCommands: (deviceId) =>
        Effect.tryPromise({
          try: async () => {
            const rows = await db.query.commands.findMany({
              where: and(eq(dbSchema.commands.deviceId, deviceId), eq(dbSchema.commands.status, "pending")),
              orderBy: [desc(dbSchema.commands.priority), asc(dbSchema.commands.createdAt)],
            });
            return rows.map(mapCommand);
          },
          catch: (cause) => new MdmError({ message: "Failed to get pending commands", cause }),
        }),

      getNextPendingCommand: (deviceId) =>
        Effect.tryPromise({
          try: async () => {
            const row = await db.query.commands.findFirst({
              where: and(eq(dbSchema.commands.deviceId, deviceId), eq(dbSchema.commands.status, "pending")),
              orderBy: [desc(dbSchema.commands.priority), asc(dbSchema.commands.createdAt)],
            });
            return row ? mapCommand(row) : null;
          },
          catch: (cause) => new MdmError({ message: "Failed to get next pending command", cause }),
        }),

      updateCommandStatus: (id, status, detail) =>
        Effect.tryPromise({
          try: async () => {
            await db.update(dbSchema.commands).set({
              status,
              resultDetail: detail ?? null,
              ...(status === "sent" ? { sentAt: new Date() } : {}),
            }).where(eq(dbSchema.commands.id, id));
          },
          catch: (cause) => new MdmError({ message: "Failed to update command status", cause }),
        }),

      insertDeclaration: (declaration) =>
        Effect.tryPromise({
          try: async () => {
            await db.insert(dbSchema.declarations).values({
              id: declaration.id,
              type: declaration.type,
              payload: declaration.payload as any,
              serverToken: declaration.serverToken,
              createdAt: declaration.createdAt,
              updatedAt: declaration.updatedAt,
            });
          },
          catch: (cause) => new MdmError({ message: "Failed to insert declaration", cause }),
        }),

      deleteDeclaration: (id) =>
        Effect.tryPromise({
          try: async () => {
            const result = await db.delete(dbSchema.declarations).where(eq(dbSchema.declarations.id, id));
            if (!result.meta.rows_written) {
              throw new DeclarationNotFound({ declarationId: id });
            }
          },
          catch: (cause) =>
            cause instanceof DeclarationNotFound
              ? cause
              : new MdmError({ message: "Failed to delete declaration", cause }),
        }),

      getDeclarations: () =>
        Effect.tryPromise({
          try: async () => {
            const rows = await db.query.declarations.findMany({
              orderBy: [asc(dbSchema.declarations.id)],
            });
            return rows.map(mapDeclaration);
          },
          catch: (cause) => new MdmError({ message: "Failed to get declarations", cause }),
        }),

      getDeclarationById: (id) =>
        Effect.tryPromise({
          try: async () => {
            const row = await db.query.declarations.findFirst({
              where: eq(dbSchema.declarations.id, id),
            });
            return row ? mapDeclaration(row) : null;
          },
          catch: (cause) => new MdmError({ message: "Failed to get declaration", cause }),
        }),

      upsertDeviceDeclaration: (state) =>
        Effect.tryPromise({
          try: async () => {
            const existing = await db.query.deviceDeclarations.findFirst({
              where: and(
                eq(dbSchema.deviceDeclarations.deviceId, state.deviceId),
                eq(dbSchema.deviceDeclarations.declarationId, state.declarationId),
              ),
            });
            if (existing) {
              await db.update(dbSchema.deviceDeclarations).set({
                status: state.status,
                detail: state.detail ?? null,
                serverToken: state.serverToken,
              }).where(eq(dbSchema.deviceDeclarations.id, existing.id));
            } else {
              await db.insert(dbSchema.deviceDeclarations).values({
                deviceId: state.deviceId,
                declarationId: state.declarationId,
                status: state.status,
                detail: state.detail ?? null,
                serverToken: state.serverToken,
              });
            }
          },
          catch: (cause) => new MdmError({ message: "Failed to upsert device declaration", cause }),
        }),

      getDeviceDeclarations: (deviceId) =>
        Effect.tryPromise({
          try: async () => {
            const rows = await db.query.deviceDeclarations.findMany({
              where: eq(dbSchema.deviceDeclarations.deviceId, deviceId),
            });
            return rows.map(mapDeviceDeclaration);
          },
          catch: (cause) => new MdmError({ message: "Failed to get device declarations", cause }),
        }),

      updateDeviceDeclarationStatus: (deviceId, declarationId, status, detail) =>
        Effect.tryPromise({
          try: async () => {
            await db.update(dbSchema.deviceDeclarations).set({
              status,
              detail: detail ?? null,
            }).where(
              and(
                eq(dbSchema.deviceDeclarations.deviceId, deviceId),
                eq(dbSchema.deviceDeclarations.declarationId, declarationId),
              ),
            );
          },
          catch: (cause) => new MdmError({ message: "Failed to update device declaration status", cause }),
        }),
    }),
  );

function mapDevice(row: typeof dbSchema.devices.$inferSelect): AppleDevice {
  return {
    id: row.id,
    udid: row.udid,
    serialNumber: row.serialNumber ?? undefined,
    model: row.model ?? undefined,
    osVersion: row.osVersion ?? undefined,
    supportsDdm: row.supportsDdm,
    pushToken: row.pushToken ?? undefined,
    pushMagic: row.pushMagic ?? undefined,
    topic: row.topic ?? undefined,
    channel: row.channel as AppleDevice["channel"],
    status: row.status as AppleDevice["status"],
    enrolledAt: row.enrolledAt,
    lastSeenAt: row.lastSeenAt,
    identityCertPem: row.identityCertPem ?? undefined,
  };
}

function mapCommand(row: typeof dbSchema.commands.$inferSelect): MdmCommand {
  return {
    id: row.id,
    deviceId: row.deviceId,
    requestType: row.requestType,
    payload: row.payload as unknown,
    status: row.status as MdmCommand["status"],
    resultDetail: row.resultDetail ?? undefined,
    priority: row.priority,
    createdAt: row.createdAt,
    sentAt: row.sentAt ?? undefined,
  };
}

function mapDeclaration(row: typeof dbSchema.declarations.$inferSelect): Declaration {
  return {
    id: row.id,
    type: row.type as Declaration["type"],
    payload: row.payload as unknown,
    serverToken: row.serverToken,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapDeviceDeclaration(row: typeof dbSchema.deviceDeclarations.$inferSelect): DeviceDeclarationState {
  return {
    id: row.id,
    deviceId: row.deviceId,
    declarationId: row.declarationId,
    status: row.status as DeviceDeclarationState["status"],
    detail: row.detail ?? undefined,
    serverToken: row.serverToken,
  };
}
