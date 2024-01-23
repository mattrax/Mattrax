// TODO: Paginated fetch
// TODO: Search
// TODO: Filtering
// TODO: Virtialisation
// TODO: Abstract into reusable components
// TODO: Skeleton loading state

import { createVirtualizer } from "@tanstack/solid-virtual";
import { createPagination } from "@solid-primitives/pagination";
import { useZodParams } from "~/utils/useZodParams";
import { z } from "zod";
import { createAsync } from "@solidjs/router";
import { client } from "~/utils";
import { Suspense } from "solid-js";

export default function Page() {
  const params = useZodParams({
    // TODO: Max and min validation
    offset: z.number().default(0),
    limit: z.number().default(50),
  });

  // TODO: Data fetching
  // const [paginationProps, page, setPage] = createPagination({
  //   // initialPage: 0,
  //   pages: 100,
  // });

  // console.log(paginationProps());

  const data = createAsync(() =>
    // TODO: Unauthorised error + Error toast on issues
    client.api.users
      .$get({
        // TODO: Query params
      })
      .then((res) => res.json())
  );

  let parentRef!: HTMLDivElement;
  const columnVirtualizer = createVirtualizer({
    horizontal: true,
    count: 10000,
    getScrollElement: () => parentRef,
    estimateSize: () => 100,
    overscan: 5,
  });

  return (
    <>
      <h1>Users page!</h1>

      <Suspense fallback={<div>Loading...</div>}>
        <p>{JSON.stringify(data())}</p>
      </Suspense>

      {/* TODO: Tailwind */}
      <div
        ref={parentRef}
        class="List"
        style={{
          width: `400px`,
          height: `100px`,
          overflow: "auto",
        }}
      >
        <div
          style={{
            width: `${columnVirtualizer.getTotalSize()}px`,
            height: "100%",
            position: "relative",
          }}
        >
          {/* TODO: For elements */}
          {columnVirtualizer.getVirtualItems().map((virtualColumn) => (
            <div
              class={virtualColumn.index % 2 ? "ListItemOdd" : "ListItemEven"}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                height: "100%",
                width: `${virtualColumn.size}px`,
                transform: `translateX(${virtualColumn.start}px)`,
              }}
            >
              Column {virtualColumn.index}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
