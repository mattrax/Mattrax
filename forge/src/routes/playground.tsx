import { CacheProvider } from "~/utils/cache.tsx";

// const bc = new BroadcastChannel("test_channel");

// TODO: Persisting to disk
// TODO: Set these up in a context so they have an owner

// TODO: Initial state should come from disk
// const store = createMutable({
//   a: 0,
// });

// const [, setStore] = createStore(store);

// bc.addEventListener("message", (payload) => {
//   const delta: NestedUpdate<any>[] = JSON.parse(payload.data);
//   console.log("IN", delta);

//   for (const change of delta) {
//     setStore(...(change.path as [any]), change.value);
//   }
// });

// const getDelta = captureStoreUpdates(store);

// createEffect(() => {
//   const payload = JSON.stringify(getDelta());
//   console.log("OUT", payload);
//   bc.postMessage(payload);
// });

export default function Page() {
  // TODO: Put this into context
  // const data = createAsync(async () => {
  //   // console.log(await db);
  //   // console.log("RESULT", await (await db).get(kbObjectStore, "a"));
  //   // return (await (await db).get(kbObjectStore, "a")) || "not found";
  // });

  return (
    <div class="flex flex-col">
      <CacheProvider />

      {/* <Suspense fallback={<div>Loading...</div>}>
        <p>{JSON.stringify(store)}</p>
      </Suspense>
      <button
        onClick={async () => {
          // const oldValue = (await (await db).get(kbObjectStore, "a")) || 0;
          // (await db).put(kbObjectStore, oldValue + 1, "a");
          store.a += 1;
          //   setStore({ a: store.a + 1 });
        }}
      >
        Update
      </button> */}
    </div>
  );
}
