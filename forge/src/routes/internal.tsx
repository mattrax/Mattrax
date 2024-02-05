import { useNavigate } from "@solidjs/router";
import { For, createEffect } from "solid-js";
import { tRPCErrorCode, trpc } from "~/lib";

export default function Page() {
  const stats = trpc.internal.stats.useQuery();

  const navigate = useNavigate();
  createEffect(() => {
    const error = tRPCErrorCode(stats.error);
    if (error === "FORBIDDEN") navigate("/");
  });

  return (
    <div class="p-2">
      <a href="/" class="hover:underline">
        Back to Dashboard
      </a>
      <h1 class="text-4xl pb-4">Top-secret dashboard</h1>
      <div class="flex flex-col space-y-2">
        <For each={Object.entries(stats.data || {})}>
          {([name, value]) => (
            <p>
              {name}: {value}
            </p>
          )}
        </For>
      </div>
    </div>
  );
}