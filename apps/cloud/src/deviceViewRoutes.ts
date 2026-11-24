import {
  EnterpriseService,
  PersonalDeviceViews,
  TenantDeviceViews,
  deviceViewOwnerId,
  deviceViewTenantId,
} from "@mattrax/enterprise-domain";
import { ProtocolError } from "@yielded/sync";
import { Cloudflare } from "@yielded/sync-platform-cloudflare";
import { Effect } from "effect";
import { HttpBody, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

const SESSION_TTL_MILLIS = 2 * 60 * 1_000;

interface DeviceViewObjectId {
  toString(): string;
}

interface DeviceViewObjectNamespace {
  idFromName(name: string): DeviceViewObjectId;
  get(id: DeviceViewObjectId): { fetch(request: Request): Promise<Response> };
}

export interface DeviceViewSyncEnv {
  readonly ORIGIN: string;
  readonly TRUSTED_ORIGINS?: string;
  readonly TENANT_DEVICE_VIEWS: DeviceViewObjectNamespace;
  readonly PERSONAL_DEVICE_VIEWS: DeviceViewObjectNamespace;
}

const sameOrigin = (left: string, right: string) => {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
};

const allowedOrigin = (
  env: Pick<DeviceViewSyncEnv, "ORIGIN" | "TRUSTED_ORIGINS">,
  origin: string,
) => {
  for (const value of [env.ORIGIN, ...(env.TRUSTED_ORIGINS?.split(",") ?? [])]) {
    const normalized = value?.trim();
    if (normalized && sameOrigin(normalized, origin)) return true;
  }

  return false;
};

const unavailable = () =>
  ProtocolError.make({
    reason: "Unavailable",
    message: "Saved device views require the Cloudflare Durable Object host.",
  });

const fetchObject = (namespace: DeviceViewObjectNamespace, name: string, request: Request) =>
  Effect.tryPromise({
    try: () => namespace.get(namespace.idFromName(name)).fetch(request),
    catch: unavailable,
  });

type DeviceViewAuthEnv = Pick<DeviceViewSyncEnv, "ORIGIN" | "TRUSTED_ORIGINS">;

export const authenticateDeviceViewSync = (env: DeviceViewAuthEnv, source: "tenant" | "personal") =>
  Effect.fn("authenticateDeviceViewSync")(function* (request: Request, address: { id: string }) {
    const origin = request.headers.get("origin");

    if (origin !== null && !allowedOrigin(env, origin))
      return yield* ProtocolError.make({
        reason: "Forbidden",
        message: "This origin cannot open a saved-view connection.",
      });

    const tenantId = source === "personal" ? deviceViewTenantId(address.id) : address.id;
    const service = yield* EnterpriseService;
    const ctx = yield* service
      .authorizeSync(HttpServerRequest.fromWeb(request), tenantId, "devices.read")
      .pipe(
        Effect.mapError((cause) => {
          const tag =
            typeof cause === "object" && cause !== null && "_tag" in cause
              ? String(cause._tag)
              : "";

          return ProtocolError.make({
            reason:
              tag.includes("Forbidden") || tag.includes("PermissionDenied")
                ? "Forbidden"
                : "Unauthenticated",
            message: "Saved device views require an authorized tenant session.",
          });
        }),
      );

    if (
      source === "personal" &&
      address.id !== deviceViewOwnerId(ctx.organization.id, ctx.account.id)
    )
      return yield* ProtocolError.make({
        reason: "Forbidden",
        message: "The saved views belong to another account.",
      });

    return {
      actorId: ctx.account.id,
      principal: {
        actorId: ctx.account.id,
        tenantId: ctx.organization.id,
        accountId: ctx.account.id,
        permissions: [...ctx.permissions],
      },
      expiresAtMillis: Date.now() + SESSION_TTL_MILLIS,
    };
  });

const route =
  (handler: (request: Request) => Effect.Effect<Response, never, unknown>) =>
  (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.mapError(unavailable));
      const response = yield* handler(web);

      // Keep the native Response as a raw body so a 101 upgrade retains its
      // Cloudflare `webSocket` property. `fromWeb` would turn it into a plain
      // bodyless Effect response and lose the accepted socket.
      return HttpServerResponse.setBody(
        HttpServerResponse.empty({
          status: response.status,
          statusText: response.statusText,
        }),
        HttpBody.raw(response),
      );
    });

export const deviceViewSyncRoutes = (env: DeviceViewSyncEnv) => {
  const tenantHandler = Cloudflare.handler(TenantDeviceViews, {
    authenticate: authenticateDeviceViewSync(env, "tenant"),
    fetch: (name, request) => fetchObject(env.TENANT_DEVICE_VIEWS, name, request),
  });
  const personalHandler = Cloudflare.handler(PersonalDeviceViews, {
    authenticate: authenticateDeviceViewSync(env, "personal"),
    fetch: (name, request) => fetchObject(env.PERSONAL_DEVICE_VIEWS, name, request),
  });

  return [
    HttpRouter.add("GET", "/api/sync/device-views/tenant/:id", route(tenantHandler)),
    HttpRouter.add("POST", "/api/sync/device-views/tenant/:id", route(tenantHandler)),
    HttpRouter.add("GET", "/api/sync/device-views/personal/:id", route(personalHandler)),
    HttpRouter.add("POST", "/api/sync/device-views/personal/:id", route(personalHandler)),
  ];
};
