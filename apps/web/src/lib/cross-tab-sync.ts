import { Option, Schema } from "effect";
import type { QueryClient } from "@tanstack/solid-query";

/**
 * Cross-tab query synchronisation.
 *
 * One `BroadcastChannel` per origin carries cache messages between dashboard
 * tabs: a mutation in one tab invalidates the same queries in every other tab
 * (and optimistic writes are mirrored), so two tabs never show different
 * truths. Messages carry the tab id that sent them and are ignored by the
 * sender; `storage` events are the fallback where `BroadcastChannel` is
 * unavailable (older Safari, some embedded webviews).
 *
 * This complements server push rather than replacing it: the broadcast covers
 * this browser, server push covers other users and machines.
 *
 * Cost control: a bulk action can call `broadcastInvalidation` fifty times. The
 * sender coalesces everything into one message per flush window and either
 * sends the deduped key list (bounded) or, above the cap, a single tenant-wide
 * invalidation. Receivers never fan out per row.
 */
export type CrossTabMessageType = "invalidate" | "set" | "reset";

export const CROSS_TAB_CHANNEL = "mattrax:query-cache";

export const CROSS_TAB_STORAGE_KEY = "mattrax:query-cache:last";

/** Wait this long so a loop of mutations produces one message. */
export const CROSS_TAB_FLUSH_MS = 40;

/** Above this many distinct keys, invalidate the whole tenant namespace once. */
export const CROSS_TAB_MAX_KEYS = 24;

const Envelope = {
  v: Schema.Literal(1),
  tabId: Schema.String,
  tenantId: Schema.NullOr(Schema.String),
  sentAt: Schema.Number,
};

const InvalidateMessage = Schema.Struct({
  ...Envelope,
  type: Schema.Literal("invalidate"),
  scope: Schema.Literals(["keys", "tenant"]),
  keys: Schema.Array(Schema.Array(Schema.Unknown)),
});

const SetMessage = Schema.Struct({
  ...Envelope,
  type: Schema.Literal("set"),
  key: Schema.Array(Schema.Unknown),
  data: Schema.Unknown,
});

const ResetMessage = Schema.Struct({
  ...Envelope,
  type: Schema.Literal("reset"),
});

export const CrossTabMessage = Schema.Union([InvalidateMessage, SetMessage, ResetMessage]);

export type CrossTabMessage = typeof CrossTabMessage.Type;

const decode = Schema.decodeUnknownOption(CrossTabMessage);

/** Decode an untrusted payload from a channel or `storage` event. */
export const decodeCrossTabMessage = (value: unknown): CrossTabMessage | undefined =>
  Option.getOrUndefined(decode(value));

let tabId: string | undefined;

/**
 * Resolve the tab id on first use. The Workers runtime rejects random values
 * during module evaluation, and this module is part of the server bundle too.
 */
const currentTabId = (): string => {
  if (tabId) return tabId;

  const uuid = globalThis.crypto?.randomUUID?.();

  tabId = uuid ?? `tab-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

  return tabId;
};

export const crossTabTabId = (): string => currentTabId();

/** A tab never applies its own message; the local cache already changed. */
export const isOwnMessage = (message: CrossTabMessage, self: string = currentTabId()): boolean =>
  message.tabId === self;

/** Stable key identity for dedupe inside a flush window. */
export const queryKeyId = (key: readonly unknown[]): string => JSON.stringify(key);

/**
 * Merge keys into a bounded, deduped set.
 *
 * Returns `undefined` when the merged set exceeds the cap: the caller then
 * sends a tenant-wide invalidation instead of a huge key list.
 */
export const mergeInvalidationKeys = (
  existing: readonly (readonly unknown[])[],
  incoming: readonly (readonly unknown[])[],
  limit: number = CROSS_TAB_MAX_KEYS,
): readonly (readonly unknown[])[] | undefined => {
  const seen = new Set<string>();
  const merged: (readonly unknown[])[] = [];

  for (const key of [...existing, ...incoming]) {
    const id = queryKeyId(key);

    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(key);

    if (merged.length > limit) return undefined;
  }

  return merged;
};

/** True when a query key belongs to `tenantId` (the id is a key element). */
export const keyTouchesTenant = (key: readonly unknown[], tenantId: string | null): boolean =>
  tenantId === null || key.some((part) => part === tenantId);

type Sender = {
  post: (message: CrossTabMessage) => void;
};

let installed = false;

let sender: Sender | undefined;

let activeTenantId: string | null = null;

const pending = new Map<
  string,
  { tenantId: string | null; keys: (readonly unknown[])[]; tenantScope: boolean }
>();

let flushTimer: ReturnType<typeof setTimeout> | undefined;

const envelope = () => ({
  v: 1 as const,
  tabId: currentTabId(),
  sentAt: Date.now(),
});

const deliver = (message: CrossTabMessage) => {
  sender?.post(message);
};

const flush = () => {
  flushTimer = undefined;

  for (const [id, batch] of pending) {
    pending.delete(id);

    const keys = batch.tenantScope ? undefined : mergeInvalidationKeys([], batch.keys);

    deliver({
      ...envelope(),
      type: "invalidate",
      tenantId: batch.tenantId,
      scope: keys === undefined ? "tenant" : "keys",
      keys: keys ?? [],
    });
  }
};

const schedule = () => {
  if (typeof window === "undefined" || flushTimer !== undefined) return;

  flushTimer = setTimeout(flush, CROSS_TAB_FLUSH_MS);
};

/**
 * Broadcast an invalidation for `keys`, or the whole tenant namespace when the
 * list would be unbounded. Coalesced with anything else queued in this window.
 */
export const broadcastInvalidation = (
  tenantId: string | null,
  keys: readonly (readonly unknown[])[],
): void => {
  if (typeof window === "undefined") return;

  const batchId = tenantId ?? "";
  const batch = pending.get(batchId) ?? { tenantId, keys: [], tenantScope: false };

  if (!batch.tenantScope) {
    const merged = mergeInvalidationKeys(batch.keys, keys);

    if (merged === undefined) batch.tenantScope = true;
    else batch.keys = [...merged];
  }

  pending.set(batchId, batch);
  schedule();
};

/** Mirror an optimistic write in other tabs. Opt-in: not every mutation should. */
export const broadcastQueryData = (
  tenantId: string | null,
  key: readonly unknown[],
  data: Schema.Json,
): void => {
  if (typeof window === "undefined") return;

  deliver({ ...envelope(), type: "set", tenantId, key, data });
};

/** Ask every tab to drop its cache (sign-out, tenant deletion). */
export const broadcastCacheReset = (tenantId: string | null): void => {
  if (typeof window === "undefined") return;

  deliver({ ...envelope(), type: "reset", tenantId });
};

/** The tenant whose mutations this tab is currently broadcasting. */
export const setCrossTabTenant = (tenantId: string | null): void => {
  activeTenantId = tenantId;
};

export const crossTabTenant = (): string | null => activeTenantId;

/**
 * The slice of a query client the sync layer uses. Narrow enough for tests to
 * provide a real object instead of a client-shaped cast.
 */
export type CrossTabCache = Pick<
  QueryClient,
  "invalidateQueries" | "setQueryData" | "removeQueries" | "clear"
>;

/**
 * Apply a message to a cache. Exported for tests; the installed listener is the
 * only production caller.
 */
export const applyCrossTabMessage = (target: CrossTabCache, message: CrossTabMessage): void => {
  switch (message.type) {
    case "invalidate": {
      if (message.scope === "tenant") {
        void target.invalidateQueries({
          predicate: (query) => keyTouchesTenant(query.queryKey, message.tenantId),
        });

        return;
      }

      for (const key of message.keys) void target.invalidateQueries({ queryKey: key });

      return;
    }

    case "set": {
      target.setQueryData(message.key, message.data);

      return;
    }

    case "reset": {
      if (message.tenantId === null) target.clear();
      else
        target.removeQueries({
          predicate: (query) => keyTouchesTenant(query.queryKey, message.tenantId),
        });
    }
  }
};

/**
 * Wire the channel into a query client. Idempotent, and a no-op on the server
 * and in browsers without `BroadcastChannel` (the `storage` path takes over).
 */
export const installCrossTabSync = (target: QueryClient): void => {
  if (installed || typeof window === "undefined") return;

  installed = true;

  const receive = (value: unknown) => {
    const message = decodeCrossTabMessage(value);

    if (!message || isOwnMessage(message)) return;

    applyCrossTabMessage(target, message);
  };

  const channel =
    "BroadcastChannel" in globalThis ? new BroadcastChannel(CROSS_TAB_CHANNEL) : undefined;

  if (channel) {
    channel.addEventListener("message", (event) => receive(event.data));
    sender = { post: (message) => channel.postMessage(message) };
  } else {
    // No structured-clone channel: a single storage slot carries the last
    // message. `storage` only fires in *other* tabs, so a sender never sees it.
    sender = {
      post: (message) => {
        try {
          localStorage.setItem(
            CROSS_TAB_STORAGE_KEY,
            JSON.stringify({ ...message, nonce: `${currentTabId()}:${Date.now()}` }),
          );
        } catch {
          // Storage disabled: cross-tab sync silently degrades to this tab only.
        }
      },
    };

    window.addEventListener("storage", (event) => {
      if (event.key !== CROSS_TAB_STORAGE_KEY || !event.newValue) return;

      try {
        receive(JSON.parse(event.newValue));
      } catch {
        // Another writer left a partial value; the next message replaces it.
      }
    });
  }
};
