import { useMutation } from "@tanstack/solid-query";
import { createEffect, For, Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { enterprise } from "~/lib/enterprise";

type Preview = { payload_description?: string; payload_organization?: string; payload_categories?: Array<{ category: string; payload_display_name?: string; payload_description?: string; payload_type?: string; payload_identifier?: string }> };

export function MobileconfigPreview(props: { content: string }) {
  const preview = useMutation(() => ({ mutationFn: () => enterprise.previewMobileconfig(props.content) as Promise<Preview> }));
  createEffect(() => { if (props.content) preview.mutate(); });
  return <div class="space-y-4"><Show when={preview.isPending}><p class="text-sm text-muted-foreground">Analyzing configuration...</p></Show><Show when={preview.data}>{(data) => <div class="space-y-4"><Show when={data().payload_description || data().payload_organization}><div class="space-y-1 border-b pb-3 text-sm"><Show when={data().payload_description}><p><span class="font-medium">Description:</span> {data().payload_description}</p></Show><Show when={data().payload_organization}><p><span class="font-medium">Organization:</span> {data().payload_organization}</p></Show></div></Show><div class="flex items-center justify-between"><h4 class="text-sm font-medium">Categories</h4><Badge variant="secondary">{data().payload_categories?.length ?? 0} payloads</Badge></div><For each={data().payload_categories ?? []}>{(category) => <div class="space-y-1 border-b py-2 text-sm last:border-0"><div class="flex gap-2"><Badge variant="outline">{category.category}</Badge><span class="font-medium">{category.payload_display_name}</span></div><p class="text-muted-foreground">{category.payload_description}</p><p class="text-xs text-muted-foreground">{category.payload_type} {category.payload_identifier ? `- ${category.payload_identifier}` : ""}</p></div>}</For></div>}</Show><Show when={preview.isError}><p class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Failed to parse configuration.</p></Show></div>;
}
