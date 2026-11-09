import { Context, Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { signApnsCsr } from "@mattrax/apns";
import { Db, schema } from "@mattrax/enterprise-core";
import { EnterpriseAuth } from "@mattrax/enterprise-domain";
import {
  PlatformBadRequest,
  PlatformNotFound,
  PlatformUnauthorized,
  type InstanceInfo,
} from "@mattrax/platform-api";

const encoder = new TextEncoder();

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256 = (value: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", encoder.encode(value))).pipe(
    Effect.map(hex),
  );

const hmac = (secret: string, value: string) =>
  Effect.gen(function* () {
    const key = yield* Effect.promise(() =>
      crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      ),
    );
    const signature = yield* Effect.promise(() =>
      crypto.subtle.sign("HMAC", key, encoder.encode(value)),
    );
    return hex(signature);
  });

const randomKey = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  for (const byte of bytes) value += alphabet[byte % alphabet.length];
  return `MTLX-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}`;
};

const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);
const now = () => new Date();
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

const statusOf = (row: typeof schema.platformInstance.$inferSelect): InstanceInfo["status"] => {
  if (row.revokedAt) return "revoked";
  if (!row.lastSeenAt) return "active";
  return Date.now() - row.lastSeenAt.getTime() > 48 * 60 * 60 * 1000 ? "inactive" : "active";
};

const toInfo = (row: typeof schema.platformInstance.$inferSelect): InstanceInfo => ({
  id: row.id,
  keyPrefix: row.keyPrefix,
  description: row.description,
  userCount: row.userCount,
  deviceCount: row.deviceCount,
  status: statusOf(row),
  createdAt: iso(row.createdAt)!,
  lastSeenAt: iso(row.lastSeenAt),
  revokedAt: iso(row.revokedAt),
});

type PlatformRequest = {
  readonly headers: Record<string, string | undefined>;
};

type PlatformResult<T> = Effect.Effect<T, any, any>;

export type PlatformServiceShape = {
  readonly list: (request: PlatformRequest) => PlatformResult<{ instances: InstanceInfo[] }>;
  readonly create: (
    request: PlatformRequest,
    payload: { description?: string | null },
  ) => PlatformResult<{ instance: InstanceInfo; key: string }>;
  readonly update: (
    request: PlatformRequest,
    instanceId: string,
    payload: { description?: string | null },
  ) => PlatformResult<{ status: "ok" }>;
  readonly revoke: (
    request: PlatformRequest,
    instanceId: string,
  ) => PlatformResult<{ status: "ok" }>;
  readonly verify: (
    request: PlatformRequest,
    payload: { userCount?: number; deviceCount?: number },
  ) => PlatformResult<{ valid: boolean; revoked: boolean }>;
  readonly signInstanceCsr: (
    request: PlatformRequest,
    payload: { csrDer: string },
  ) => PlatformResult<{ pushCertCertificateChain: Array<string>; pushCertSignature: string }>;
};

export class PlatformService extends Context.Service<PlatformService, PlatformServiceShape>()(
  "PlatformService",
) {}

export type PlatformServiceOptions = {
  readonly cloudAppleVendorCert?: string;
  readonly cloudAppleVendorKey?: string;
};

export const PlatformServiceLive = (options: PlatformServiceOptions = {}) =>
  Layer.effect(
    PlatformService,
    Effect.gen(function* () {
      const db = yield* Db;
      const auth = yield* EnterpriseAuth;

      const requireUser = (request: PlatformRequest) =>
        auth
          .requireUser({ headers: request.headers })
          .pipe(Effect.mapError(() => new PlatformUnauthorized({ message: "Unauthenticated" })));

      const findOwned = (userId: string, instanceId: string) =>
        Effect.gen(function* () {
          const row = yield* db.query.platformInstance.findFirst({
            where: { id: instanceId, issuedByUserId: userId },
          });
          if (!row)
            return yield* Effect.fail(new PlatformNotFound({ message: "Instance not found" }));
          return row;
        });

      return PlatformService.of({
        list: (request) =>
          Effect.gen(function* () {
            const { user } = yield* requireUser(request);
            const rows = yield* db.query.platformInstance.findMany({
              where: { issuedByUserId: user.id },
            });
            return { instances: rows.map(toInfo) };
          }),
        create: (request, payload) =>
          Effect.gen(function* () {
            const { user } = yield* requireUser(request);
            const key = randomKey();
            const keyHash = yield* sha256(key);
            const timestamp = now();
            const row = {
              id: id(),
              keyPrefix: key.slice(0, 13),
              keyHash,
              description: payload.description ?? null,
              issuedByUserId: user.id,
              userCount: 0,
              deviceCount: 0,
              createdAt: timestamp,
              updatedAt: timestamp,
              lastSeenAt: null,
              revokedAt: null,
            };
            yield* db.insert(schema.platformInstance).values(row);
            return { instance: toInfo(row as typeof schema.platformInstance.$inferSelect), key };
          }),
        update: (request, instanceId, payload) =>
          Effect.gen(function* () {
            const { user } = yield* requireUser(request);
            yield* findOwned(user.id, instanceId);
            yield* db
              .update(schema.platformInstance)
              .set({ description: payload.description ?? null, updatedAt: now() })
              .where(eq(schema.platformInstance.id, instanceId));
            return { status: "ok" as const };
          }),
        revoke: (request, instanceId) =>
          Effect.gen(function* () {
            const { user } = yield* requireUser(request);
            yield* findOwned(user.id, instanceId);
            yield* db
              .update(schema.platformInstance)
              .set({ revokedAt: now(), updatedAt: now() })
              .where(eq(schema.platformInstance.id, instanceId));
            return { status: "ok" as const };
          }),
        verify: (request, payload) =>
          Effect.gen(function* () {
            const key = request.headers["x-mattrax-key"];
            const timestamp = Number(request.headers["x-mattrax-timestamp"]);
            const signature = request.headers["x-mattrax-signature"];
            if (!key || !signature || !Number.isFinite(timestamp))
              return yield* Effect.fail(
                new PlatformBadRequest({ message: "Missing instance authentication headers" }),
              );
            if (Math.abs(Date.now() / 1000 - timestamp) > 300)
              return yield* Effect.fail(
                new PlatformBadRequest({ message: "Stale request timestamp" }),
              );

            const keyHash = yield* sha256(key);
            const row = yield* db.query.platformInstance.findFirst({ where: { keyHash } });
            if (!row) return { valid: false, revoked: false };

            const expected = yield* hmac(
              key,
              `${timestamp}.${payload.userCount ?? 0}:${payload.deviceCount ?? 0}`,
            );
            if (expected !== signature)
              return yield* Effect.fail(new PlatformBadRequest({ message: "Invalid signature" }));

            if (row.revokedAt) return { valid: false, revoked: true };

            yield* db
              .update(schema.platformInstance)
              .set({
                userCount: payload.userCount ?? row.userCount,
                deviceCount: payload.deviceCount ?? row.deviceCount,
                lastSeenAt: now(),
                updatedAt: now(),
              })
              .where(eq(schema.platformInstance.id, row.id));
            return { valid: true, revoked: false };
          }),
        signInstanceCsr: (request, payload) =>
          Effect.gen(function* () {
            const key = request.headers["x-mattrax-key"];
            const timestamp = Number(request.headers["x-mattrax-timestamp"]);
            const signature = request.headers["x-mattrax-signature"];
            if (!key || !signature || !Number.isFinite(timestamp))
              return yield* Effect.fail(
                new PlatformBadRequest({ message: "Missing instance authentication headers" }),
              );
            if (Math.abs(Date.now() / 1000 - timestamp) > 300)
              return yield* Effect.fail(
                new PlatformBadRequest({ message: "Stale request timestamp" }),
              );

            const keyHash = yield* sha256(key);
            const instance = yield* db.query.platformInstance.findFirst({ where: { keyHash } });
            if (!instance || instance.revokedAt)
              return yield* Effect.fail(
                new PlatformUnauthorized({ message: "Unknown or revoked instance key" }),
              );

            const expected = yield* hmac(key, `${timestamp}.${payload.csrDer}`);
            if (expected !== signature)
              return yield* Effect.fail(new PlatformBadRequest({ message: "Invalid signature" }));

            if (!options.cloudAppleVendorKey || !options.cloudAppleVendorCert)
              return yield* Effect.fail(
                new PlatformBadRequest({ message: "APNs vendor signing is not configured" }),
              );

            const der = Uint8Array.from(atob(payload.csrDer), (char) => char.charCodeAt(0));
            const signed = yield* Effect.tryPromise({
              try: () =>
                signApnsCsr(
                  der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer,
                  options.cloudAppleVendorKey!,
                ),
              catch: () => new PlatformBadRequest({ message: "Could not sign the CSR" }),
            });
            const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signed)));
            const chain = options.cloudAppleVendorCert.match(
              /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
            ) ?? [options.cloudAppleVendorCert];
            return { pushCertCertificateChain: chain, pushCertSignature: signatureBase64 };
          }),
      });
    }),
  );
