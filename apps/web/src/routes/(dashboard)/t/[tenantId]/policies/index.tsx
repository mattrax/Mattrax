import { useParams, useSearchParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createEffect, createSignal, Show } from "solid-js";
import {
  EmptyState,
  formatDate,
  LinkButton,
  Page,
  PageHeader,
  relativeTime,
} from "~/components/mdm/common";
import { EntityHoverCard } from "~/components/entity-hover-card";
import { EntityActions } from "~/components/mdm/entity-actions";
import {
  EntityQueryBar,
  formatEntityQuery,
  matchesEntityQuery,
  parseEntityQuery,
  type EntityCondition,
  type EntityField,
} from "~/components/mdm/entity-query";
import { MdmTable } from "~/components/mdm/table";
import { Badge } from "~/components/ui/badge";
import { ShieldCheck } from "~/components/ui/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { enterprise, enterpriseKeys, type PolicyRow } from "~/lib/enterprise";
import {
  policyDeliveryPresentation,
  policyDeliverySortRank,
  policyScopePresentation,
} from "~/lib/policy-delivery";
import { useCan } from "~/lib/permissions";
import { routes } from "~/lib/routes";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
import { enterpriseQueries } from "~/lib/enterprise";

const configurationCount = (row: PolicyRow) =>
  row.configurationCount ?? Object.keys(row.configurations ?? {}).length;

function PolicyCountCell(props: { count: number | undefined; label: string; description: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        as="span"
        tabindex={0}
        aria-label={`${props.label}. ${props.description}`}
        class="inline-flex cursor-default rounded-[5px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span class={props.count && props.count > 0 ? undefined : "text-muted-foreground"}>
          {props.count ?? "—"}
        </span>
      </TooltipTrigger>
      <TooltipContent class="max-w-[260px]">{props.description}</TooltipContent>
    </Tooltip>
  );
}

function PolicyDeliveryCell(props: { row: PolicyRow }) {
  const delivery = () => props.row.delivery;

  return (
    <Show
      when={delivery()}
      fallback={
        <span class="text-muted-foreground" aria-label="Delivery not reported">
          —
        </span>
      }
    >
      {(info) => {
        const presentation = () => policyDeliveryPresentation(info());

        return (
          <Tooltip>
            <TooltipTrigger
              as="span"
              tabindex={0}
              aria-label={`${presentation().label}. ${presentation().description}`}
              class="inline-flex cursor-default rounded-[5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <Badge variant={presentation().tone} dot={presentation().dot}>
                {presentation().label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent class="max-w-[280px]">
              <p class="text-[11px] font-medium">{presentation().label}</p>
              <p class="mt-1 text-[11.5px] leading-relaxed">{presentation().description}</p>
            </TooltipContent>
          </Tooltip>
        );
      }}
    </Show>
  );
}

const fields: ReadonlyArray<EntityField<PolicyRow>> = [
  { id: "name", label: "Name", kind: "text", get: (row) => row.name },
  { id: "notes", label: "Notes", kind: "text", get: (row) => row.notes ?? "" },
  { id: "priority", label: "Priority", kind: "number", get: (row) => row.priority ?? 0 },
  {
    id: "configurations",
    label: "Configurations",
    kind: "number",
    get: (row) => configurationCount(row),
  },
];

export const route = {
  preload: ({ params, intent }: { params: { tenantId?: string }; intent: string }) => {
    const tenantId = params.tenantId;

    if (intent === "initial" || !tenantId) return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.list(tenantId, "policy")),
    ]);
  },
};

export default function PoliciesPage() {
  const params = useParams();
  const { can } = useCan();
  const [searchParams, setSearchParams] = useSearchParams();
  const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const [conditions, setConditions] = createSignal<EntityCondition[]>(
    parseEntityQuery(param(searchParams.query), fields),
  );

  // Mirror back/forward and shared links into the query bar. The signal is
  // seeded once; without this, a URL change while the page stays mounted was
  // ignored.
  createEffect(
    () => param(searchParams.query),
    (value) => {
      setConditions(parseEntityQuery(value, fields));
    },
  );

  const updateConditions = (next: EntityCondition[]) => {
    setConditions(next);
    setSearchParams({ query: formatEntityQuery(next) }, { replace: true });
  };

  const policies = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "policy"),
    queryFn: () => enterprise.list(params.tenantId, "policy"),
  }));

  const rows = () =>
    (policies.data?.rows ?? []).filter((row) => matchesEntityQuery(conditions(), row, fields));

  return (
    <Page>
      <PageHeader
        eyebrow="Configuration"
        title="Policies"
        description="Configure device restrictions, payloads, and deployment behavior."
        meta={
          <Show when={policies.data}>
            <span class="tabular-nums">
              {rows().length} {rows().length === 1 ? "policy" : "policies"}
            </span>
            <span class="text-muted-foreground/40" aria-hidden="true">
              ·
            </span>
            <span>
              {rows().filter((row) => configurationCount(row) > 0).length} with configurations
            </span>
          </Show>
        }
        actions={
          <Show when={can("policies.write") && rows().length > 0}>
            <LinkButton href={routes.tenant(params.tenantId).newPolicy()}>Create policy</LinkButton>
          </Show>
        }
      />
      <MdmTable<PolicyRow>
        rows={rows()}
        selectable={can("policies.write")}
        loading={policies.isPending}
        isFetching={policies.isFetching}
        onRefresh={() => void policies.refetch()}
        error={policies.error}
        storageKey="policies"
        toolbar={
          <EntityQueryBar fields={fields} conditions={conditions()} onChange={updateConditions} />
        }
        rowHref={(row) => routes.tenant(params.tenantId).policy(row.id)}
        actions={(selected, clear, select) => (
          <EntityActions entity="policy" selected={selected} clear={clear} select={select} />
        )}
        empty={
          conditions().length > 0 ? (
            <EmptyState
              icon={(props) => <ShieldCheck {...props} />}
              title="No matching policies"
              description="Adjust the filter or clear it from the query bar."
            />
          ) : (
            <EmptyState
              icon={(props) => <ShieldCheck {...props} />}
              title="No policies"
              description="Create a policy to start configuring managed devices."
              action={
                <Show when={can("policies.write")}>
                  <LinkButton href={routes.tenant(params.tenantId).newPolicy()}>
                    Create policy
                  </LinkButton>
                </Show>
              }
            />
          )
        }
        columns={[
          {
            id: "name",
            header: "Policy",
            sort: (row) => row.name,
            search: (row) => `${row.name} ${row.notes ?? ""}`,
            cell: (row) => (
              <span class="block min-w-0">
                <EntityHoverCard
                  preview={{ kind: "policy", policy: row }}
                  href={routes.tenant(params.tenantId).policy(row.id)}
                  class="block truncate font-medium hover:underline"
                >
                  {row.name}
                </EntityHoverCard>
                <Show when={row.notes}>
                  <span class="mt-0.5 block max-w-[38ch] truncate text-[11px] text-muted-foreground">
                    {row.notes}
                  </span>
                </Show>
              </span>
            ),
          },
          {
            id: "configurations",
            header: "Configurations",
            sort: (row) => configurationCount(row),
            cell: (row) => {
              const count = configurationCount(row);

              return (
                <Badge variant={count > 0 ? "secondary" : "outline"} class="tabular-nums">
                  {count}
                </Badge>
              );
            },
          },
          {
            id: "devices",
            header: "Devices",
            sort: (row) => row.scopedDeviceCount ?? 0,
            cell: (row) => {
              const scope = () =>
                policyScopePresentation({
                  deviceCount: row.scopedDeviceCount,
                  userCount: row.scopedUserCount,
                });

              return (
                <PolicyCountCell
                  count={row.scopedDeviceCount}
                  label={scope().devices.label}
                  description={scope().devices.description}
                />
              );
            },
          },
          {
            id: "users",
            header: "Users",
            sort: (row) => row.scopedUserCount ?? 0,
            cell: (row) => {
              const scope = () =>
                policyScopePresentation({
                  deviceCount: row.scopedDeviceCount,
                  userCount: row.scopedUserCount,
                });

              return (
                <PolicyCountCell
                  count={row.scopedUserCount}
                  label={scope().users.label}
                  description={scope().users.description}
                />
              );
            },
          },
          {
            id: "delivery",
            header: "Delivery",
            sort: (row) => policyDeliverySortRank(row.delivery?.state),
            cell: (row) => <PolicyDeliveryCell row={row} />,
          },
          {
            id: "priority",
            header: "Priority",
            sort: (row) => row.priority,
            cell: (row) => (
              <span class="tabular-nums text-muted-foreground">{row.priority ?? 0}</span>
            ),
          },
          {
            id: "updated",
            header: "Updated",
            sort: (row) => row.updatedAt,
            cell: (row) => (
              <span class="block min-w-0">
                <span class="block whitespace-nowrap text-[12.5px]">
                  {relativeTime(row.updatedAt)}
                </span>
                <span class="block truncate text-[11px] text-muted-foreground">
                  {formatDate(row.updatedAt)}
                </span>
              </span>
            ),
          },
          {
            id: "created",
            header: "Created",
            defaultHidden: true,
            sort: (row) => row.createdAt,
            cell: (row) => (
              <span class="whitespace-nowrap text-[12.5px] text-muted-foreground">
                {formatDate(row.createdAt)}
              </span>
            ),
          },
        ]}
      />
    </Page>
  );
}
