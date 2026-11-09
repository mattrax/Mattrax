import { useMutation } from "@tanstack/solid-query";
import { createEffect, For, Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { enterprise } from "~/lib/enterprise";

function read<T>(data: Record<string, unknown>, camel: string, snake: string): T | undefined {
  return (data[camel] ?? data[snake]) as T | undefined;
}

type Preview = {
  payloadDisplayName?: string;
  payload_description?: string;
  payloadDescription?: string;
  payloadOrganization?: string;
  payload_organization?: string;
  payloads?: Array<{
    type?: string;
    payloadType?: string;
    identifier?: string;
    payloadIdentifier?: string;
    displayName?: string;
    payloadDisplayName?: string;
    description?: string;
    payloadDescription?: string;
    category?: string;
  }>;
  payload_categories?: Array<{
    category: string;
    payload_display_name?: string;
    payload_description?: string;
    payload_type?: string;
    payload_identifier?: string;
  }>;
};

export function MobileconfigPreview(props: { content: string }) {
  const preview = useMutation(() => ({
    mutationFn: () => enterprise.previewMobileconfig(props.content) as unknown as Promise<Preview>,
  }));
  createEffect(
    () => props.content,
    (content) => {
      if (content) preview.mutate();
    },
  );
  const rows = () => {
    const data = preview.data;
    if (!data) return [];
    if (data.payloads)
      return data.payloads.map((item) => ({
        category: item.category,
        displayName: item.displayName ?? item.payloadDisplayName,
        description: item.description ?? item.payloadDescription,
        type: item.type ?? item.payloadType,
        identifier: item.identifier ?? item.payloadIdentifier,
      }));
    return (data.payload_categories ?? []).map((item) => ({
      category: item.category,
      displayName: item.payload_display_name,
      description: item.payload_description,
      type: item.payload_type,
      identifier: item.payload_identifier,
    }));
  };
  const description = () => {
    const data = preview.data;
    return data ? (data.payloadDescription ?? data.payload_description) : undefined;
  };
  const organization = () => {
    const data = preview.data;
    return data ? (data.payloadOrganization ?? data.payload_organization) : undefined;
  };

  return (
    <div class="space-y-4">
      <Show when={preview.isPending}>
        <p class="text-sm text-muted-foreground">Analyzing configuration…</p>
      </Show>
      <Show when={preview.data}>
        <div class="space-y-4">
          <Show when={description() || organization()}>
            <div class="space-y-1 border-b pb-3 text-sm">
              <Show when={description()}>
                <p>
                  <span class="font-medium">Description:</span> {description()}
                </p>
              </Show>
              <Show when={organization()}>
                <p>
                  <span class="font-medium">Organization:</span> {organization()}
                </p>
              </Show>
            </div>
          </Show>
          <div class="flex items-center justify-between">
            <h4 class="text-sm font-medium">Payloads</h4>
            <Badge variant="secondary">{rows().length} payloads</Badge>
          </div>
          <Show when={rows().length > 0} fallback={<p class="text-sm text-muted-foreground">No payloads found.</p>}>
            <For each={rows()}>
              {(item) => (
                <div class="space-y-1 border-b py-2 text-sm last:border-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <Show when={item.category}>
                      <Badge variant="outline">{item.category}</Badge>
                    </Show>
                    <span class="font-medium">{item.displayName ?? item.type ?? "Payload"}</span>
                  </div>
                  <Show when={item.description}>
                    <p class="text-muted-foreground">{item.description}</p>
                  </Show>
                  <p class="text-xs text-muted-foreground">
                    {item.type} {item.identifier ? `· ${item.identifier}` : ""}
                  </p>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>
      <Show when={preview.isError}>
        <p class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Failed to parse configuration.
        </p>
      </Show>
    </div>
  );
}
