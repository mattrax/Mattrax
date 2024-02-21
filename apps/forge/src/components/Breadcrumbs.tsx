import { createContextProvider } from "@solid-primitives/context";
import { onCleanup, JSX, For, onMount } from "solid-js";
import { createStore } from "solid-js/store";

export const [BreadcrumbContextProvider, useBreadcrumbContext] =
  createContextProvider(() => {
    const [breadcrumbs, setBreadcrumbs] = createStore<JSX.Element[]>([]);

    return { breadcrumbs, setBreadcrumbs };
  }, null!);

export function Breadcrumbs() {
  const { breadcrumbs } = useBreadcrumbContext();

  return (
    <div class="flex flex-row items-center gap-3">
      <For each={breadcrumbs}>
        {(breadcrumb) => (
          <>
            <div class="text-xl text-gray-300">/</div>
            {breadcrumb}
          </>
        )}
      </For>
    </div>
  );
}

export function createBreadcrumb(jsx: JSX.Element) {
  const { setBreadcrumbs } = useBreadcrumbContext();

  setBreadcrumbs((prev) => [...prev, jsx]);

  onCleanup(() => {
    setBreadcrumbs((p) => p.filter((j) => j !== jsx));
  });
}
