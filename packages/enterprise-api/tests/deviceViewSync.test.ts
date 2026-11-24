import { createHash } from "node:crypto";
import {
  PersonalDeviceViews,
  TenantDeviceViews,
  deviceViewOwnerId,
} from "@mattrax/enterprise-domain";
import { PersonalDeviceViewsServer, TenantDeviceViewsServer } from "../src/deviceViewSync.js";
import { Server, ServerCrypto, SourceStorage, StorageError } from "@yielded/sync/server";
import type {
  ReceiptIdentity,
  SourceTransaction,
  StorageCommit,
  StoredEvent,
  StoredHead,
  StoredReceipt,
} from "@yielded/sync/server";
import { Effect, Layer, Schema, Scope } from "effect";
import { describe, expect, it } from "vitest";

type MemoryData = {
  head?: StoredHead;
  events: Array<StoredEvent>;
  receipts: Array<StoredReceipt>;
};

const memoryStorage = () => {
  const data: MemoryData = { events: [], receipts: [] };

  const transaction: SourceTransaction = {
    readHead: Effect.sync(() => data.head),
    initialize: (head) =>
      Effect.sync(() => {
        if (data.head) throw StorageError.make({ message: "Head already exists" });
        data.head = head;
      }),
    readReceipt: (identity: ReceiptIdentity) =>
      Effect.sync(() =>
        data.receipts.find(
          (receipt) =>
            receipt.actorId === identity.actorId &&
            receipt.commandId === identity.commandId &&
            (identity.sourceAuthorityGeneration === null
              ? (receipt.command as { readonly admittedGeneration?: string | null })
                  .admittedGeneration === null
              : receipt.sourceAuthorityGeneration === identity.sourceAuthorityGeneration),
        ),
      ),
    readEvents: (after, limit) =>
      Effect.sync(() =>
        data.events
          .filter(
            (event) =>
              event.position.sourceAuthorityGeneration === after.sourceAuthorityGeneration &&
              event.position.cursor > after.cursor,
          )
          .slice(0, limit),
      ),
    commit: (plan: StorageCommit) =>
      Effect.sync(() => {
        if (
          !data.head ||
          data.head.position.sourceAuthorityGeneration !==
            plan.expected.sourceAuthorityGeneration ||
          data.head.position.cursor !== plan.expected.cursor
        )
          throw StorageError.make({ message: "Stale commit" });
        if (plan.outbox.length > 0) throw StorageError.make({ message: "Unexpected outbox work" });

        data.head = plan.head;
        data.events.push(...plan.events);
        data.receipts.push(plan.receipt);
      }),
  };

  return Layer.succeed(SourceStorage, {
    transaction: (body) =>
      Effect.suspend(() => {
        const before = structuredClone(data);

        return body(transaction).pipe(
          Effect.tapError(() => Effect.sync(() => Object.assign(data, before))),
        );
      }),
  } satisfies SourceStorage["Service"]);
};

const cryptoLayer = Layer.succeed(ServerCrypto, {
  generation: Effect.sync(() => crypto.randomUUID()),
  sha256: (value) => Effect.sync(() => createHash("sha256").update(value).digest("hex")),
});

const session = (
  tenantId = "tenant-a",
  accountId = "account-a",
  permissions: ReadonlyArray<"devices.read" | "devices.write"> = ["devices.read", "devices.write"],
) => ({
  actorId: accountId,
  connectionId: "connection-a",
  expiresAtMillis: Date.now() + 60_000,
  principal: { actorId: accountId, tenantId, accountId, permissions },
});

const draft = (id: string, name: string) => ({
  view: {
    id,
    name,
    description: null,
    query: { columns: [] },
    createdByAccountId: "spoofed-account",
  },
});

const sharedCommand = (
  commandId: string,
  payload: ReturnType<typeof draft>,
  admittedGeneration: string,
) =>
  Schema.decodeUnknownSync(TenantDeviceViews.actions.create.command)({
    protocolVersion: 1,
    commandId,
    address: TenantDeviceViews.address("tenant-a"),
    admittedGeneration,
    namespace: "$source",
    action: "create",
    schemaVersion: 1,
    payload,
  });

const makeRunner = () => {
  const runtimeLayer = Layer.mergeAll(memoryStorage(), cryptoLayer);

  return <A, E>(effect: Effect.Effect<A, E, SourceStorage | ServerCrypto | Scope.Scope>) =>
    Effect.runPromise(effect.pipe(Effect.provide(runtimeLayer), Effect.scoped));
};

describe("Yielded Sync device views", () => {
  it("commits a tenant view and replays the original receipt exactly once", async () => {
    const run = makeRunner();
    const runtime = await run(
      Server.open(TenantDeviceViewsServer, TenantDeviceViews.address("tenant-a")),
    );
    const initial = await run(runtime.snapshot(session()));
    const command = sharedCommand(
      "command-a",
      draft("view-a", "Fleet"),
      initial.position.sourceAuthorityGeneration,
    );
    const first = await run(runtime.execute(session(), TenantDeviceViews.actions.create, command));
    const retry = await run(runtime.execute(session(), TenantDeviceViews.actions.create, command));
    const snapshot = await run(runtime.snapshot(session()));

    expect(first._tag).toBe("Succeeded");
    expect(retry).toEqual(first);
    expect(snapshot.snapshot.source.views).toHaveLength(1);
    expect(snapshot.snapshot.source.views[0]).toMatchObject({
      id: "view-a",
      createdByAccountId: "account-a",
    });
  });

  it("rejects duplicate tenant names without advancing the cursor", async () => {
    const run = makeRunner();
    const runtime = await run(
      Server.open(TenantDeviceViewsServer, TenantDeviceViews.address("tenant-a")),
    );
    const initial = await run(runtime.snapshot(session()));
    const generation = initial.position.sourceAuthorityGeneration;
    await run(
      runtime.execute(
        session(),
        TenantDeviceViews.actions.create,
        sharedCommand("command-a", draft("view-a", "Fleet"), generation),
      ),
    );
    const duplicate = await run(
      runtime.execute(
        session(),
        TenantDeviceViews.actions.create,
        sharedCommand("command-b", draft("view-b", "Fleet"), generation),
      ),
    );
    const snapshot = await run(runtime.snapshot(session()));

    expect(duplicate._tag).toBe("Rejected");
    if (duplicate._tag === "Rejected") expect(duplicate.error.reason).toBe("Duplicate");
    expect(snapshot.position.cursor).toBe(1);
    expect(snapshot.snapshot.source.views).toHaveLength(1);
  });

  it("requires devices.write for shared actions but allows read-only subscriptions", async () => {
    const run = makeRunner();
    const runtime = await run(
      Server.open(TenantDeviceViewsServer, TenantDeviceViews.address("tenant-a")),
    );
    const initial = await run(runtime.snapshot(session("tenant-a", "account-a", ["devices.read"])));
    const error = await run(
      runtime
        .execute(
          session("tenant-a", "account-a", ["devices.read"]),
          TenantDeviceViews.actions.create,
          sharedCommand(
            "command-a",
            draft("view-a", "Fleet"),
            initial.position.sourceAuthorityGeneration,
          ),
        )
        .pipe(Effect.flip),
    );

    expect(error.reason).toBe("Forbidden");
  });

  it("binds private state to the tenant and account in the source id", async () => {
    const run = makeRunner();
    const runtime = await run(
      Server.open(
        PersonalDeviceViewsServer,
        PersonalDeviceViews.address(deviceViewOwnerId("tenant-a", "account-a")),
      ),
    );
    await run(runtime.snapshot(session()));
    const error = await run(runtime.snapshot(session("tenant-b", "account-a")).pipe(Effect.flip));

    expect(error.reason).toBe("Forbidden");
  });

  it("clears a private default when its view is deleted", async () => {
    const run = makeRunner();
    const id = deviceViewOwnerId("tenant-a", "account-a");
    const runtime = await run(
      Server.open(PersonalDeviceViewsServer, PersonalDeviceViews.address(id)),
    );
    const initial = await run(runtime.snapshot(session()));
    const generation = initial.position.sourceAuthorityGeneration;
    const createCommand = Schema.decodeUnknownSync(PersonalDeviceViews.actions.create.command)({
      protocolVersion: 1,
      commandId: "command-create",
      address: PersonalDeviceViews.address(id),
      admittedGeneration: generation,
      namespace: "$source",
      action: "create",
      schemaVersion: 1,
      payload: draft("view-a", "Mine"),
    });
    await run(runtime.execute(session(), PersonalDeviceViews.actions.create, createCommand));

    const defaultCommand = Schema.decodeUnknownSync(PersonalDeviceViews.actions.setDefault.command)(
      {
        protocolVersion: 1,
        commandId: "command-default",
        address: PersonalDeviceViews.address(id),
        admittedGeneration: generation,
        namespace: "$source",
        action: "setDefault",
        schemaVersion: 1,
        payload: { viewId: "view-a" },
      },
    );
    await run(runtime.execute(session(), PersonalDeviceViews.actions.setDefault, defaultCommand));

    const deleteCommand = Schema.decodeUnknownSync(PersonalDeviceViews.actions.delete.command)({
      protocolVersion: 1,
      commandId: "command-delete",
      address: PersonalDeviceViews.address(id),
      admittedGeneration: generation,
      namespace: "$source",
      action: "delete",
      schemaVersion: 1,
      payload: { id: "view-a" },
    });
    await run(runtime.execute(session(), PersonalDeviceViews.actions.delete, deleteCommand));
    const snapshot = await run(runtime.snapshot(session()));

    expect(snapshot.snapshot.source.views).toHaveLength(0);
    expect(snapshot.snapshot.source.defaultViewId).toBeNull();
  });
});
