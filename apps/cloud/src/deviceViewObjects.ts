import { PersonalDeviceViewsServer, TenantDeviceViewsServer } from "@mattrax/enterprise-api";
import type { Source } from "@yielded/sync";
import { Cloudflare } from "@yielded/sync-platform-cloudflare";
import type { Server } from "@yielded/sync/server";
import { Effect, ManagedRuntime, Scope } from "effect";

/**
 * Yielded's effect-cf adapter is convenient, but Mattrax already owns its
 * Worker runtime. This thin native adapter keeps the Durable Object scope
 * alive for the instance without pulling another framework into the bundle.
 */
const nativeHandlers = <S extends Source.Spec>(
  server: Server.Definition<S>,
  state: DurableObjectState,
  options: Cloudflare.Options,
) => {
  const runtime = ManagedRuntime.make(Cloudflare.layer(state.storage, options));

  return runtime.runPromise(
    Cloudflare.make(server, state, options).pipe(Effect.provideService(Scope.Scope, runtime.scope)),
  );
};

export class TenantDeviceViewsObject {
  readonly #handlers: Promise<Cloudflare.Handlers>;

  constructor(state: DurableObjectState, _env: Env) {
    this.#handlers = nativeHandlers(TenantDeviceViewsServer, state, {
      storage: { namespace: "mattrax-device-views-tenant-v1", replayWindow: 512 },
      sockets: { maxConnections: 100, bufferSize: 256 },
    });
  }

  async fetch(request: Request) {
    return Effect.runPromise(
      (await this.#handlers)
        .fetch(request)
        .pipe(Effect.catch((error) => Effect.succeed(Cloudflare.errorResponse(error)))),
    );
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    await Effect.runPromise((await this.#handlers).webSocketMessage(socket, message));
  }

  async webSocketClose(socket: WebSocket) {
    await Effect.runPromise((await this.#handlers).webSocketClose(socket));
  }

  async webSocketError(socket: WebSocket) {
    await Effect.runPromise((await this.#handlers).webSocketError(socket));
  }

  async alarm() {
    await Effect.runPromise((await this.#handlers).alarm);
  }
}

export class PersonalDeviceViewsObject {
  readonly #handlers: Promise<Cloudflare.Handlers>;

  constructor(state: DurableObjectState, _env: Env) {
    this.#handlers = nativeHandlers(PersonalDeviceViewsServer, state, {
      storage: { namespace: "mattrax-device-views-personal-v1", replayWindow: 512 },
      sockets: { maxConnections: 100, bufferSize: 256 },
    });
  }

  async fetch(request: Request) {
    return Effect.runPromise(
      (await this.#handlers)
        .fetch(request)
        .pipe(Effect.catch((error) => Effect.succeed(Cloudflare.errorResponse(error)))),
    );
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    await Effect.runPromise((await this.#handlers).webSocketMessage(socket, message));
  }

  async webSocketClose(socket: WebSocket) {
    await Effect.runPromise((await this.#handlers).webSocketClose(socket));
  }

  async webSocketError(socket: WebSocket) {
    await Effect.runPromise((await this.#handlers).webSocketError(socket));
  }

  async alarm() {
    await Effect.runPromise((await this.#handlers).alarm);
  }
}
