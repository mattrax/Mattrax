import { makeBroadcastChannel } from "@solid-primitives/broadcast-channel";
import {
  makePersisted,
  type AsyncStorageWithOptions,
} from "@solid-primitives/storage";
import { captureStoreUpdates, type NestedUpdate } from "@solid-primitives/deep";
import { createEffect, ParentProps, Suspense } from "solid-js";
import { createMutable, createStore } from "solid-js/store";
import { get, set, del, clear } from "idb-keyval";

// TODO: Break this out into another package

// TODO: Cache clearing??? (unload inactive parts from memory while keeping it on disk)
// TODO: Real-time updates from the backend
// TODO: Refetch on window active

class Cache<T extends Record<string, any> = {}> {
  //   ctx: Sol;

  constructor() {}

  // TODO: Avoid the user needing to provide name twice (once as generic and once as param)
  register<V, K extends string>(name: K): Cache<T & { [key in K]: V }> {
    return this;
  }

  // TODO: Fix return type
  build(): T {
    return {} as T;
  }
}

export function createCache() {
  return new Cache();
}

function idbkvToAsyncStorage(): AsyncStorageWithOptions {
  return {
    clear: () => clear(),
    getItem: (key) => get<string>(key),
    // getAll?: () => Promise<any>;
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
    // key: (index: number) => Promise<string | null> | string | null;
    // readonly length: Promise<number> | number | undefined;
    // [key: string]: any;
  };
}

export function CacheProvider(props: ParentProps<{ cache: Cache<any> }>) {
  const { postMessage, onMessage } = makeBroadcastChannel<string>("cache");
  const [store, setStore] = makePersisted(
    createStore<Record<string, any>>({}),
    {
      storage: idbkvToAsyncStorage(),
    }
  );

  onMessage((msg) => {
    const delta: NestedUpdate<any>[] = JSON.parse(msg.data);
    console.log("IN", delta); // TODO

    for (const change of delta) {
      setStore(...(change.path as [any]), change.value);
    }
  });

  const getDelta = captureStoreUpdates(store);
  createEffect(() => {
    const payload = JSON.stringify(getDelta());
    console.log("OUT", payload); // TODO
    postMessage(payload);
  });

  // TODO: Wrap stuff

  // TODO: Remove this stuff
  return (
    <>
      <Suspense fallback={<div>Loading...</div>}>
        <p>{JSON.stringify(store)}</p>
      </Suspense>
      <button
        onClick={async () => {
          setStore({ a: store.a + 1 });
        }}
      >
        Update
      </button>
    </>
  );
}

// export function useCache(scope: string): Store<T> {}

const myCache = createCache()
  .register<string, "a">("a")
  .register<number, "b">("b")
  .build();

// const myCache = createCache({
//     testing: lazy<string>(),
//   })
