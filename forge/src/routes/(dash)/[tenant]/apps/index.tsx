import { createAsync } from "@solidjs/router";
import { Suspense, createSignal } from "solid-js";

export default function Page() {
  // TODO: Proper page with DB. This is more of a tech demo.

  return (
    <div class="flex flex-col">
      <AppleAppStore />
    </div>
  );
}

function AppleAppStore() {
  const [search, setSearch] = createSignal();

  const data = createAsync(() => {
    // TODO: Typescript types
    // TODO: Pagination support
    return fetch(
      `https://itunes.apple.com/search?term=${search()}&entity=software`
    ).then((res) => res.json());
  });
  return (
    <>
      <input
        type="text"
        class="border border-gray-300 rounded-md p-2"
        placeholder="Search"
        onInput={(e) => setSearch(e.currentTarget.value)}
      />
      <div class="grid grid-cols-3 gap-4">
        {/* TODO: Empty and error states */}
        <Suspense fallback={<div>Loading...</div>}>
          {data()?.results.map((app) => (
            <div class="flex flex-col">
              <img src={app.artworkUrl100} />
              <div class="text-sm">{app.trackName}</div>
              <div class="text-xs">{app.sellerName}</div>
            </div>
          ))}
        </Suspense>
      </div>
    </>
  );
}
