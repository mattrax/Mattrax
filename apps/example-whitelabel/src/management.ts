import { Effect, Layer } from "effect";
import {
  ManagementBackend,
  InternalServerError,
  type AppleDeviceEvent,
  type CheckinScope,
  type ManagementManifest,
  type DdmTokens,
  type DdmDeclarationItems,
} from "@mattrax/management-backend";
import { type CommandRow, type DeviceRow, sha256hex } from "./db.js";

export const ManagementBackendD1 = (db: D1Database, apps: R2Bucket) =>
  Layer.succeed(
    ManagementBackend,
    ManagementBackend.of({
      appleDeviceEvent: (scope: CheckinScope, event: AppleDeviceEvent) =>
        Effect.tryPromise({
          try: async () => {
            const { udid } = scope;
            if (event._tag === "Authenticate") {
              await db
                .prepare(
                  `INSERT INTO devices (udid, serial_number, model, os_version)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT (udid) DO UPDATE SET
                     serial_number = excluded.serial_number,
                     model = excluded.model,
                     os_version = excluded.os_version,
                     unenrolled_at = NULL`,
                )
                .bind(udid, event.serialNumber ?? null, event.model ?? null, event.osVersion ?? null)
                .run();
            } else if (event._tag === "TokenUpdate" && event.channel === "device") {
              await db
                .prepare("UPDATE devices SET push_token = ?, push_magic = ?, apns_topic = ? WHERE udid = ?")
                .bind(event.pushToken, event.pushMagic, event.topic, udid)
                .run();
            } else if (event._tag === "CheckOut") {
              await db.prepare("UPDATE devices SET unenrolled_at = unixepoch() WHERE udid = ?").bind(udid).run();
            } else if (event._tag === "CommandResult") {
              await db
                .prepare(
                  "UPDATE pending_commands SET status = ?, completed_at = unixepoch() WHERE command_uuid = ?",
                )
                .bind(event.status, event.commandUUID)
                .run();
            }
          },
          catch: (cause) => (console.error("[management]", cause), new InternalServerError()),
        }),

      appleManagementCheckin: (scope: CheckinScope) =>
        Effect.gen(function* () {
          const state = yield* Effect.tryPromise({
            try: async () => {
              const { udid } = scope;
              const device = await db
                .prepare("SELECT * FROM devices WHERE udid = ?")
                .bind(udid)
                .first<DeviceRow>();
              if (!device || device.unenrolled_at !== null) return { tag: "idle" as const };

              const cmd = await db
                .prepare(
                  "SELECT * FROM pending_commands WHERE device_udid = ? AND completed_at IS NULL ORDER BY created_at ASC LIMIT 1",
                )
                .bind(udid)
                .first<CommandRow>();
              if (cmd) return { tag: "command" as const, cmd };

              const { results } = await db
                .prepare(
                  "SELECT identifier, server_token FROM device_declarations WHERE device_udid = ? ORDER BY identifier",
                )
                .bind(udid)
                .all<{ identifier: string; server_token: string }>();
              if (results.length > 0) {
                const token = await sha256hex(JSON.stringify(results));
                return { tag: "ddm" as const, token };
              }

              return { tag: "idle" as const };
            },
            catch: (cause) => (console.error("[management]", cause), new InternalServerError()),
          });

          switch (state.tag) {
            case "idle":
              return { _tag: "Idle" } as ManagementManifest;
            case "command":
              return {
                _tag: "Command",
                commandUUID: state.cmd.command_uuid,
                requestType: state.cmd.request_type,
                payload: JSON.parse(state.cmd.payload) as unknown,
              } as ManagementManifest;
            case "ddm":
              return { _tag: "DdmSync", serverToken: state.token } as ManagementManifest;
          }
        }),

      getAppleDeclarationTokens: (scope: CheckinScope) =>
        Effect.tryPromise({
          try: async (): Promise<DdmTokens> => {
            const { results } = await db
              .prepare(
                "SELECT category, identifier, server_token FROM device_declarations WHERE device_udid = ? ORDER BY identifier",
              )
              .bind(scope.udid)
              .all<{ category: string; identifier: string; server_token: string }>();

            const byCategory: Record<string, typeof results> = {};
            for (const row of results) {
              (byCategory[row.category] ??= []).push(row);
            }

            const hashCat = async (cat: string): Promise<string> => {
              const items = byCategory[cat] ?? [];
              return items.length > 0 ? sha256hex(JSON.stringify(items)) : "empty";
            };

            return {
              activationsToken: await hashCat("activations"),
              configurationsToken: await hashCat("configurations"),
              assetsToken: await hashCat("assets"),
              managementToken: await hashCat("management"),
            };
          },
          catch: (cause) => (console.error("[management]", cause), new InternalServerError()),
        }),

      getAppleDeclarationItems: (scope: CheckinScope) =>
        Effect.tryPromise({
          try: async (): Promise<DdmDeclarationItems> => {
            const { results } = await db
              .prepare(
                "SELECT identifier, server_token, category FROM device_declarations WHERE device_udid = ? ORDER BY identifier",
              )
              .bind(scope.udid)
              .all<{ identifier: string; server_token: string; category: string }>();

            const items = {
              activations: [] as { identifier: string; serverToken: string }[],
              configurations: [] as { identifier: string; serverToken: string }[],
              assets: [] as { identifier: string; serverToken: string }[],
              management: [] as { identifier: string; serverToken: string }[],
            };
            for (const row of results) {
              const cat = row.category as keyof typeof items;
              if (cat in items) {
                items[cat].push({ identifier: row.identifier, serverToken: row.server_token });
              }
            }
            return items;
          },
          catch: (cause) => (console.error("[management]", cause), new InternalServerError()),
        }),

      getAppleDeclaration: (scope: CheckinScope, _type: string, identifier: string) =>
        Effect.tryPromise({
          try: async () => {
            const row = await db
              .prepare("SELECT payload FROM device_declarations WHERE device_udid = ? AND identifier = ?")
              .bind(scope.udid, identifier)
              .first<{ payload: string }>();
            return row ? (JSON.parse(row.payload) as Record<string, unknown>) : null;
          },
          catch: (cause) => (console.error("[management]", cause), new InternalServerError()),
        }),

      getAppleAsset: (_cert: string | undefined, identifier: string) =>
        Effect.tryPromise({
          try: async () => {
            const obj = await apps.get(identifier);
            if (!obj) return null;
            const buf = await obj.arrayBuffer();
            return {
              content: new Uint8Array(buf),
              contentType: obj.httpMetadata?.contentType ?? "application/octet-stream",
            };
          },
          catch: (cause) => (console.error("[management]", cause), new InternalServerError()),
        }),
    }),
  );
