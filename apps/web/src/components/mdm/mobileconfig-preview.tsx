import { useMutation } from "@tanstack/solid-query";
import { Option, Schema } from "effect";
import { createEffect, For, Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { CircleAlert } from "~/components/ui/icons";
import { DocumentationLink } from "~/components/mdm/documentation-link";
import { enterprise } from "~/lib/enterprise";
import { errorMessage, raisedFailure } from "~/lib/errors";
import { applePayloadDocumentationUrl } from "~/lib/policy-designer/documentation";

const Preview = Schema.Struct({
  payloadDisplayName: Schema.optional(Schema.String),
  payload_description: Schema.optional(Schema.String),
  payloadDescription: Schema.optional(Schema.String),
  payloadOrganization: Schema.optional(Schema.String),
  payload_organization: Schema.optional(Schema.String),
  payloads: Schema.optional(
    Schema.Array(
      Schema.Struct({
        type: Schema.optional(Schema.String),
        payloadType: Schema.optional(Schema.String),
        identifier: Schema.optional(Schema.String),
        payloadIdentifier: Schema.optional(Schema.String),
        displayName: Schema.optional(Schema.String),
        payloadDisplayName: Schema.optional(Schema.String),
        description: Schema.optional(Schema.String),
        payloadDescription: Schema.optional(Schema.String),
        category: Schema.optional(Schema.String),
      }),
    ),
  ),
  payload_categories: Schema.optional(
    Schema.Array(
      Schema.Struct({
        category: Schema.String,
        payload_display_name: Schema.optional(Schema.String),
        payload_description: Schema.optional(Schema.String),
        payload_type: Schema.optional(Schema.String),
        payload_identifier: Schema.optional(Schema.String),
      }),
    ),
  ),
});

type Preview = typeof Preview.Type;

const decodePreview = Schema.decodeUnknownOption(Preview);

export function MobileconfigPreview(props: { content: string }) {
  const preview = useMutation(() => ({
    mutationFn: async () =>
      Option.getOrUndefined(decodePreview(await enterprise.previewMobileconfig(props.content))) ??
      {},
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
        <p class="text-[12.5px] text-muted-foreground">Analyzing configuration…</p>
      </Show>
      <Show when={preview.data}>
        <div class="space-y-4">
          <Show when={description() || organization()}>
            <dl class="grid gap-1.5 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-[12px] sm:grid-cols-[auto_1fr] sm:gap-x-4 sm:gap-y-1">
              <Show when={description()}>
                <div class="contents">
                  <dt class="font-medium text-muted-foreground">Description</dt>
                  <dd class="text-foreground">{description()}</dd>
                </div>
              </Show>
              <Show when={organization()}>
                <div class="contents">
                  <dt class="font-medium text-muted-foreground">Organization</dt>
                  <dd class="text-foreground">{organization()}</dd>
                </div>
              </Show>
            </dl>
          </Show>
          <div class="flex items-center justify-between gap-2">
            <h4 class="text-[12.5px] font-semibold text-foreground">Payloads</h4>
            <Badge variant="secondary" class="tabular-nums">
              {rows().length} payloads
            </Badge>
          </div>
          <Show
            when={rows().length > 0}
            fallback={<p class="text-[12.5px] text-muted-foreground">No payloads found.</p>}
          >
            <div class="divide-y divide-border/60 overflow-hidden rounded-lg border border-border">
              <For each={rows()}>
                {(item) => (
                  <div class="space-y-1 bg-muted/10 px-3 py-2.5 text-[12.5px]">
                    <div class="flex flex-wrap items-center gap-2">
                      <Show when={item.category}>
                        <Badge variant="outline" class="text-[10px] text-muted-foreground">
                          {item.category}
                        </Badge>
                      </Show>
                      <span class="font-medium text-foreground">
                        {item.displayName ?? item.type ?? "Payload"}
                      </span>
                      <Show when={applePayloadDocumentationUrl(item.type)}>
                        {(href) => (
                          <DocumentationLink
                            href={href()}
                            source="Apple"
                            subject={item.displayName ?? item.type ?? "this payload"}
                            class="ml-auto"
                          />
                        )}
                      </Show>
                    </div>
                    <Show when={item.description}>
                      <p class="text-muted-foreground">{item.description}</p>
                    </Show>
                    <p class="truncate font-mono text-[10.5px] text-muted-foreground">
                      {item.type} {item.identifier ? `· ${item.identifier}` : ""}
                    </p>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
      <Show when={preview.isError}>
        <p class="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-[12.5px] text-destructive">
          <CircleAlert class="mt-0.5 size-3.5 shrink-0" />
          <span>
            {errorMessage(raisedFailure(preview.error), "Failed to parse configuration.")}
          </span>
        </p>
      </Show>
    </div>
  );
}
