import { lazy, Loading } from "solid-js";
import { LoadingState } from "~/components/ui";

const LazyPolicyDesigner = lazy(() =>
  import("~/components/mdm/policy-designer").then((module) => ({
    default: module.PolicyDesigner,
  })),
);

export default function DesignerPage() {
  return (
    <main class="flex h-[calc(100svh-4rem)] min-h-0 w-full flex-col overflow-hidden bg-stone-50">
      <h1 class="sr-only">MDM policy designer</h1>
      <Loading
        fallback={
          <div class="flex flex-1 items-center justify-center">
            <LoadingState label="Loading policy designer…" size={20} />
          </div>
        }
      >
        <LazyPolicyDesigner mode="public" />
      </Loading>
    </main>
  );
}
