import { Suspense, lazy } from "solid-js";

const Editor = lazy(() => import("./editor"));

export default function Page() {
  return (
    <div class="flex flex-col space-y-2">
      <h2 class="text-2xl font-bold mb-4">Scripts</h2>
      <Suspense fallback={<div>Loading...</div>}>
        <Editor />
      </Suspense>
    </div>
  );
}
