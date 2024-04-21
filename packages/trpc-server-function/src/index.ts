import {
  type CancelFn,
  type Operation,
  type PromiseAndCancel,
  TRPCClientError,
  type TRPCLink,
} from "@trpc/client";
import {
  type AnyRouter,
  type ProcedureType,
  callProcedure,
  type DataTransformer,
} from "@trpc/server";
import { observable } from "@trpc/server/observable";
import type { TRPCResponse } from "@trpc/server/rpc";
import { getEvent } from "vinxi/http";
import { TRPC_REQUEST } from "./server";

export type TrpcServerFunctionOpts = StringifiedOpts;

interface TrpcServerFunctionOptsObject {
  operations: Array<Pick<Operation, "path" | "input">>;
  type: ProcedureType;
}

export async function trpcServerFunction<TRouter extends AnyRouter>({
  router,
  createContext,
  opts: stringifiedOpts,
}: {
  router: TRouter;
  createContext: any;
  opts: StringifiedOpts;
}) {
  "use server";

  const opts = parseOpts(stringifiedOpts);

  const event = getEvent();
  const ctx = createContext(event);

  let flush!: () => void;
  const flushPromise = new Promise<void>((res) => (flush = res));

  (event as any)[TRPC_REQUEST] = { flush };

  const responses = opts.operations.map(async (o) => ({
    result: {
      data: await callProcedure({
        procedures: router._def.procedures,
        path: o.path,
        rawInput: o.input,
        ctx,
        type: opts.type,
      }),
    },
  }));

  await flushPromise;

  return responses;
}

export const seroval = {
  serialize: (d) => d,
  deserialize: (d) => d,
} satisfies DataTransformer;

type RequesterFn = (requesterOpts: { type: ProcedureType }) => (
  batchOps: Operation[],
  unitResolver: (
    index: number,
    value: NonNullable<Promise<TRPCResponse>>,
  ) => void,
) => {
  promise: Promise<Promise<TRPCResponse>[]>;
  cancel: CancelFn;
};

type StringifiedOpts = string & { _brand: "TrpcServerFunctionOpts" };

function stringifyOpts(opts: TrpcServerFunctionOptsObject): StringifiedOpts {
  return JSON.stringify(opts) as any;
}

function parseOpts(stringified: StringifiedOpts): TrpcServerFunctionOptsObject {
  return JSON.parse(stringified);
}

export const createServerFunctionLink = <TRouter extends AnyRouter>(
  serverFunction: (
    opts: StringifiedOpts,
  ) => ReturnType<typeof trpcServerFunction<TRouter>>,
): TRPCLink<TRouter> => {
  return () => {
    const batchLoader = (type: ProcedureType) => {
      const fetch: ReturnType<RequesterFn> = (operations) => {
        const promise = serverFunction(stringifyOpts({ type, operations }));

        return { promise, cancel: () => {} };
      };

      return { fetch, validate: () => true };
    };

    const query = dataLoader(batchLoader("query"));
    const mutation = dataLoader(batchLoader("mutation"));
    const subscription = dataLoader(batchLoader("subscription"));

    const loaders = { query, subscription, mutation };

    return ({ op }) => {
      return observable((observer) => {
        const loader = loaders[op.type];
        const { promise, cancel } = loader.load(op);

        promise
          .then((p) => p)
          .then((response) => {
            if ("error" in response) {
              observer.error(
                TRPCClientError.from(
                  response,
                  // 	, {
                  // 	meta: response.meta,
                  // }
                ),
              );
              return;
            } else {
              observer.next({
                // context: res.meta,
                result: response.result,
              });
              observer.complete();
            }
          })
          .catch((err) => {
            observer.error(
              TRPCClientError.from(
                err,
                // 	{
                // 	meta: _res?.meta,
                // }
              ),
            );
          });

        return cancel;
      });
    };
  };
};

type BatchItem<TKey, TValue> = {
  aborted: boolean;
  key: TKey;
  resolve: ((value: TValue) => void) | null;
  reject: ((error: Error) => void) | null;
  batch: Batch<TKey, TValue> | null;
};
type Batch<TKey, TValue> = {
  items: BatchItem<TKey, TValue>[];
  cancel: CancelFn;
};
type BatchLoader<TKey, TValue> = {
  validate: (keys: TKey[]) => boolean;
  fetch: (
    keys: TKey[],
    unitResolver: (index: number, value: NonNullable<TValue>) => void,
  ) => {
    promise: Promise<TValue[]>;
    cancel: CancelFn;
  };
};

/**
 * Dataloader that's very inspired by https://github.com/graphql/dataloader
 * Less configuration, no caching, and allows you to cancel requests
 * When cancelling a single fetch the whole batch will be cancelled only when _all_ items are cancelled
 */
export function dataLoader<TKey, TValue>(
  batchLoader: BatchLoader<TKey, TValue>,
) {
  let pendingItems: BatchItem<TKey, TValue>[] | null = null;
  let dispatchTimer: ReturnType<typeof setTimeout> | null = null;

  const destroyTimerAndPendingItems = () => {
    clearTimeout(dispatchTimer as any);
    dispatchTimer = null;
    pendingItems = null;
  };

  /**
   * Iterate through the items and split them into groups based on the `batchLoader`'s validate function
   */
  function groupItems(items: BatchItem<TKey, TValue>[]) {
    const groupedItems: BatchItem<TKey, TValue>[][] = [[]];
    let index = 0;
    while (true) {
      const item = items[index];
      if (!item) {
        // we're done
        break;
      }
      const lastGroup = groupedItems[groupedItems.length - 1]!;

      if (item.aborted) {
        // Item was aborted before it was dispatched
        item.reject?.(new Error("Aborted"));
        index++;
        continue;
      }

      const isValid = batchLoader.validate(
        lastGroup.concat(item).map((it) => it.key),
      );

      if (isValid) {
        lastGroup.push(item);
        index++;
        continue;
      }

      if (lastGroup.length === 0) {
        item.reject?.(new Error("Input is too big for a single dispatch"));
        index++;
        continue;
      }
      // Create new group, next iteration will try to add the item to that
      groupedItems.push([]);
    }
    return groupedItems;
  }

  function dispatch() {
    const groupedItems = groupItems(pendingItems!);
    destroyTimerAndPendingItems();

    // Create batches for each group of items
    for (const items of groupedItems) {
      if (!items.length) {
        continue;
      }
      const batch: Batch<TKey, TValue> = {
        items,
        cancel: throwFatalError,
      };
      for (const item of items) {
        item.batch = batch;
      }
      const unitResolver = (index: number, value: NonNullable<TValue>) => {
        const item = batch.items[index]!;
        item.resolve?.(value);
        item.batch = null;
        item.reject = null;
        item.resolve = null;
      };
      const { promise, cancel } = batchLoader.fetch(
        batch.items.map((_item) => _item.key),
        unitResolver,
      );
      batch.cancel = cancel;

      promise
        .then((result) => {
          for (let i = 0; i < result.length; i++) {
            const value = result[i]!;
            unitResolver(i, value);
          }
          for (const item of batch.items) {
            item.reject?.(new Error("Missing result"));
            item.batch = null;
          }
        })
        .catch((cause) => {
          for (const item of batch.items) {
            item.reject?.(cause);
            item.batch = null;
          }
        });
    }
  }
  function load(key: TKey): PromiseAndCancel<TValue> {
    const item: BatchItem<TKey, TValue> = {
      aborted: false,
      key,
      batch: null,
      resolve: throwFatalError,
      reject: throwFatalError,
    };

    const promise = new Promise<TValue>((resolve, reject) => {
      item.reject = reject;
      item.resolve = resolve;

      if (!pendingItems) {
        pendingItems = [];
      }
      pendingItems.push(item);
    });

    if (!dispatchTimer) {
      dispatchTimer = setTimeout(dispatch);
    }
    const cancel = () => {
      item.aborted = true;

      if (item.batch?.items.every((item) => item.aborted)) {
        // All items in the batch have been cancelled
        item.batch.cancel();
        item.batch = null;
      }
    };

    return { promise, cancel };
  }

  return {
    load,
  };
}

/**
 * A function that should never be called unless we messed something up.
 */
const throwFatalError = () => {
  throw new Error(
    "Something went wrong. Please submit an issue at https://github.com/trpc/trpc/issues/new",
  );
};
