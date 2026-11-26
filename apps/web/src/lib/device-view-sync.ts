import type {
  DeviceView,
  DeviceViewListResponse,
  DeviceViewQuery,
} from "@mattrax/enterprise-domain/client";
import {
  PersonalDeviceViews,
  PersonalDeviceViewsClient,
  TenantDeviceViews,
  TenantDeviceViewsClient,
  deviceViewOwnerId,
} from "@mattrax/enterprise-domain/client";
import { Client } from "@yielded/sync/client";
import { Effect, Layer, ManagedRuntime, Option, Scope, Stream } from "effect";
import * as Socket from "effect/socket/Socket";
import { isServer } from "@solidjs/web";
import { enterpriseKeys } from "~/lib/enterprise";
import { queryClient } from "~/lib/query-client";

type SharedHandle = {
  readonly runtime: ManagedRuntime.ManagedRuntime<Client.Transport, never>;
  readonly lease: Client.Lease<typeof TenantDeviceViews.spec>;
  readonly selection: Client.Selection<
    ReadonlyArray<import("@mattrax/enterprise-domain/client").SyncedDeviceView>
  >;
};

type PersonalHandle = {
  readonly runtime: ManagedRuntime.ManagedRuntime<Client.Transport, never>;
  readonly lease: Client.Lease<typeof PersonalDeviceViews.spec>;
  readonly views: Client.Selection<
    ReadonlyArray<import("@mattrax/enterprise-domain/client").SyncedDeviceView>
  >;
  readonly defaultViewId: Client.Selection<string | null>;
};

type Session = {
  readonly key: string;
  readonly tenantId: string;
  readonly accountId: string;
  readonly shared: SharedHandle;
  readonly personal: PersonalHandle;
  refs: number;
};

const asError = (error: unknown) =>
  error instanceof Error
    ? error
    : new Error(
        typeof error === "object" && error !== null && "message" in error
          ? String(error.message)
          : "Saved device views are temporarily unavailable.",
      );

const webSocketUrl = (path: string, id: string) => {
  const url = new URL(path + "/" + encodeURIComponent(id), window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

  return url.toString();
};

const openShared = async (tenantId: string, accountId: string, onChange: () => void) => {
  const transport = Client.layerWebSocketTransport(TenantDeviceViews, {
    url: webSocketUrl(TenantDeviceViews.path, tenantId),
  }).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal));
  const runtime = ManagedRuntime.make(transport);

  try {
    const session = await runtime.runPromise(
      Client.make(TenantDeviceViewsClient, { persistence: { mode: "volatile" } }).pipe(
        Effect.provideService(Client.CurrentActor, { actorId: accountId }),
        Effect.provideService(Scope.Scope, runtime.scope),
      ),
    );
    const lease = await runtime.runPromise(
      session
        .open(TenantDeviceViews.address(tenantId))
        .pipe(Effect.provideService(Scope.Scope, runtime.scope)),
    );
    await runtime.runPromise(lease.ready);
    const selection = lease.select((snapshot) => snapshot.views);
    runtime.runFork(
      selection.changes.pipe(
        Stream.runForEach(() => Effect.sync(onChange)),
        Effect.catchCause((cause) =>
          Effect.sync(() => console.error("Device view sync failed", cause)),
        ),
      ),
    );

    return { runtime, lease, selection } satisfies SharedHandle;
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
};

const openPersonal = async (tenantId: string, accountId: string, onChange: () => void) => {
  const id = deviceViewOwnerId(tenantId, accountId);
  const transport = Client.layerWebSocketTransport(PersonalDeviceViews, {
    url: webSocketUrl(PersonalDeviceViews.path, id),
  }).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal));
  const runtime = ManagedRuntime.make(transport);

  try {
    const session = await runtime.runPromise(
      Client.make(PersonalDeviceViewsClient, { persistence: { mode: "volatile" } }).pipe(
        Effect.provideService(Client.CurrentActor, { actorId: accountId }),
        Effect.provideService(Scope.Scope, runtime.scope),
      ),
    );
    const lease = await runtime.runPromise(
      session
        .open(PersonalDeviceViews.address(id))
        .pipe(Effect.provideService(Scope.Scope, runtime.scope)),
    );
    await runtime.runPromise(lease.ready);
    const views = lease.select((snapshot) => snapshot.views);
    const defaultViewId = lease.select((snapshot) => snapshot.defaultViewId);
    runtime.runFork(
      views.changes.pipe(
        Stream.runForEach(() => Effect.sync(onChange)),
        Effect.catchCause((cause) =>
          Effect.sync(() => console.error("Device view sync failed", cause)),
        ),
      ),
    );
    runtime.runFork(
      defaultViewId.changes.pipe(
        Stream.runForEach(() => Effect.sync(onChange)),
        Effect.catchCause((cause) =>
          Effect.sync(() => console.error("Device view sync failed", cause)),
        ),
      ),
    );

    return { runtime, lease, views, defaultViewId } satisfies PersonalHandle;
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
};

const present = (
  view: import("@mattrax/enterprise-domain/client").SyncedDeviceView,
  accountId: string,
  defaultViewId: string | null,
  visibility: DeviceView["visibility"],
): DeviceView => ({
  ...view,
  visibility,
  isOwner: view.createdByAccountId === accountId,
  isDefault: view.id === defaultViewId,
});

class DeviceViewSync {
  readonly #sessions = new Map<string, Promise<Session>>();

  async #acquire(tenantId: string, accountId: string) {
    if (isServer) throw new Error("Saved device views connect only in the browser.");

    const key = deviceViewOwnerId(tenantId, accountId);
    let pending = this.#sessions.get(key);

    if (!pending) {
      pending = (async () => {
        const onChange = () => void this.#publish(tenantId, accountId);
        const [sharedResult, personalResult] = await Promise.allSettled([
          openShared(tenantId, accountId, onChange),
          openPersonal(tenantId, accountId, onChange),
        ]);

        if (sharedResult.status === "rejected") {
          if (personalResult.status === "fulfilled") await personalResult.value.runtime.dispose();
          throw sharedResult.reason;
        }
        if (personalResult.status === "rejected") {
          await sharedResult.value.runtime.dispose();
          throw personalResult.reason;
        }

        return {
          key,
          tenantId,
          accountId,
          shared: sharedResult.value,
          personal: personalResult.value,
          refs: 0,
        } satisfies Session;
      })().catch((error: unknown) => {
        this.#sessions.delete(key);
        throw asError(error);
      });
      this.#sessions.set(key, pending);
    }

    const session = await pending;
    session.refs += 1;

    return session;
  }

  async #read(session: Session): Promise<DeviceViewListResponse> {
    const [shared, personal, defaultViewId] = await Promise.all([
      session.shared.runtime.runPromise(session.shared.selection.read),
      session.personal.runtime.runPromise(session.personal.views.read),
      session.personal.runtime.runPromise(session.personal.defaultViewId.read),
    ]);
    const sharedViews = Option.getOrUndefined(shared) ?? [];
    const privateViews = Option.getOrUndefined(personal) ?? [];
    const defaultId = Option.getOrUndefined(defaultViewId) ?? null;

    return {
      views: [
        ...sharedViews.map((view) => present(view, session.accountId, defaultId, "tenant")),
        ...privateViews.map((view) => present(view, session.accountId, defaultId, "private")),
      ].sort(
        (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
      ),
    };
  }

  async #publish(tenantId: string, accountId: string) {
    const pending = this.#sessions.get(deviceViewOwnerId(tenantId, accountId));
    if (!pending) return;

    try {
      const data = await this.#read(await pending);
      queryClient.setQueryData(enterpriseKeys.deviceViews(tenantId), data);
    } catch (error) {
      console.error("Could not publish device view replica", error);
    }
  }

  release(tenantId: string, accountId: string) {
    const key = deviceViewOwnerId(tenantId, accountId);
    const pending = this.#sessions.get(key);
    if (!pending) return;

    void pending
      .then((session) => {
        session.refs -= 1;
        if (session.refs > 0) return;
        this.#sessions.delete(key);
        void session.shared.runtime.dispose();
        void session.personal.runtime.dispose();
      })
      .catch(() => undefined);
  }

  async retain(tenantId: string, accountId: string) {
    await this.#acquire(tenantId, accountId);
  }

  async list(tenantId: string, accountId: string) {
    const session = await this.#acquire(tenantId, accountId);
    try {
      return await this.#read(session);
    } finally {
      this.release(tenantId, accountId);
    }
  }

  async create(
    tenantId: string,
    accountId: string,
    input: {
      name: string;
      description?: string | null;
      visibility?: "private" | "tenant";
      query: DeviceViewQuery;
    },
  ) {
    const session = await this.#acquire(tenantId, accountId);
    const visibility = input.visibility ?? "private";
    const view = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      description: input.description?.trim() || null,
      query: input.query,
      createdByAccountId: accountId,
    };

    try {
      return await (visibility === "tenant"
        ? session.shared.runtime.runPromise(
            session.shared.lease.execute(TenantDeviceViews.actions.create, { view }),
          )
        : session.personal.runtime.runPromise(
            session.personal.lease.execute(PersonalDeviceViews.actions.create, { view }),
          ));
    } catch (error) {
      throw asError(error);
    } finally {
      this.release(tenantId, accountId);
    }
  }

  async patch(
    tenantId: string,
    accountId: string,
    viewId: string,
    patch: {
      name?: string;
      description?: string | null;
      visibility?: "private" | "tenant";
      query?: DeviceViewQuery;
    },
  ) {
    const session = await this.#acquire(tenantId, accountId);
    try {
      const current = (await this.#read(session)).views.find((view) => view.id === viewId);
      if (!current) throw new Error("View not found.");
      if (patch.visibility !== undefined && patch.visibility !== current.visibility)
        throw new Error("A saved view cannot move between private and tenant visibility.");

      const payload = {
        id: viewId,
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.description === undefined ? {} : { description: patch.description }),
        ...(patch.query === undefined ? {} : { query: patch.query }),
      };

      await (current.visibility === "tenant"
        ? session.shared.runtime.runPromise(
            session.shared.lease.execute(TenantDeviceViews.actions.update, payload),
          )
        : session.personal.runtime.runPromise(
            session.personal.lease.execute(PersonalDeviceViews.actions.update, payload),
          ));
    } catch (error) {
      throw asError(error);
    } finally {
      this.release(tenantId, accountId);
    }
  }

  async delete(tenantId: string, accountId: string, viewId: string) {
    const session = await this.#acquire(tenantId, accountId);
    try {
      const current = (await this.#read(session)).views.find((view) => view.id === viewId);
      if (!current) throw new Error("View not found.");

      await (current.visibility === "tenant"
        ? session.shared.runtime.runPromise(
            session.shared.lease.execute(TenantDeviceViews.actions.delete, { id: viewId }),
          )
        : session.personal.runtime.runPromise(
            session.personal.lease.execute(PersonalDeviceViews.actions.delete, { id: viewId }),
          ));
    } catch (error) {
      throw asError(error);
    } finally {
      this.release(tenantId, accountId);
    }
  }

  async setDefault(tenantId: string, accountId: string, viewId: string | null) {
    const session = await this.#acquire(tenantId, accountId);
    try {
      await session.personal.runtime.runPromise(
        session.personal.lease.execute(PersonalDeviceViews.actions.setDefault, { viewId }),
      );
    } catch (error) {
      throw asError(error);
    } finally {
      this.release(tenantId, accountId);
    }
  }
}

export const deviceViewSync = new DeviceViewSync();
