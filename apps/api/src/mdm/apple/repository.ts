import { Context, Effect, Layer } from "effect";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "../../db";
import * as dbSchema from "../../db/schema";
import { type MdmCommand, MdmError } from "./schema";

export class AppleMdmRepository extends Context.Service<
  AppleMdmRepository,
  {
    readonly insertCommand: (command: MdmCommand) => Effect.Effect<void, MdmError>;
    readonly getPendingCommands: (deviceId: string) => Effect.Effect<MdmCommand[], MdmError>;
    readonly getNextPendingCommand: (deviceId: string) => Effect.Effect<MdmCommand | null, MdmError>;
    readonly updateCommandStatus: (id: string, status: MdmCommand["status"], detail?: string) => Effect.Effect<void, MdmError>;
    readonly storePushInfo: (
      deviceId: string,
      udid: string,
      pushToken: string,
      pushMagic: string,
      topic: string,
      channel: "device" | "user",
    ) => Effect.Effect<void, MdmError>;
    readonly getDevicePushInfo: (deviceId: string) => Effect.Effect<{
      pushToken: string;
      pushMagic: string;
      topic: string;
    } | null, MdmError>;
  }
>()("AppleMdmRepository") {}

export const AppleMdmRepositoryLive = (db: Database) =>
  Layer.succeed(AppleMdmRepository)(
    AppleMdmRepository.of({
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

      storePushInfo: (deviceId, udid, pushToken, pushMagic, topic, channel) =>
        Effect.tryPromise({
          try: async () => {
            const now = new Date();
            await db
              .insert(dbSchema.devices)
              .values({
                id: deviceId,
                udid,
                pushToken,
                pushMagic,
                topic,
                supportsDdm: false,
                channel,
                status: "active",
                enrolledAt: now,
                lastSeenAt: now,
              })
              .onConflictDoUpdate({
                target: dbSchema.devices.id,
                set: { pushToken, pushMagic, topic, lastSeenAt: now },
              });
          },
          catch: (cause) => new MdmError({ message: "Failed to store device push info", cause }),
        }),

      getDevicePushInfo: (deviceId) =>
        Effect.tryPromise({
          try: async () => {
            const row = await db.query.devices.findFirst({
              where: eq(dbSchema.devices.id, deviceId),
              columns: { pushToken: true, pushMagic: true, topic: true },
            });
            if (!row?.pushToken || !row.pushMagic || !row.topic) return null;
            return { pushToken: row.pushToken, pushMagic: row.pushMagic, topic: row.topic };
          },
          catch: (cause) => new MdmError({ message: "Failed to get device push info", cause }),
        }),
    }),
  );

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
