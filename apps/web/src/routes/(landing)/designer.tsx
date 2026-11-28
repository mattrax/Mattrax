import { lazy, Loading } from "solid-js";
import { LoadingState } from "@mattrax/ui";

const LazyPolicyDesigner = lazy(() => import("~/components/mdm/policy-designer"));

export default function DesignerPage() {
  return (
    <main style="--designer-height: calc(100svh - 4rem)" class="flex h-(--designer-height) min-h-0 w-full flex-col overflow-hidden bg-page">
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
