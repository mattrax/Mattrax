import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createSignal, Show } from "solid-js";
import {
  EmptyState,
  formatDate,
  LinkButton,
  Page,
  PageHeader,
  relativeTime,
} from "~/components/mdm/common";
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
import { enterprise, enterpriseKeys, type PolicyRow } from "~/lib/enterprise";

const configurationCount = (row: PolicyRow) => Object.keys(row.configurations ?? {}).length;

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

export default function PoliciesPage() {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const [conditions, setConditions] = createSignal<EntityCondition[]>(
    parseEntityQuery(param(searchParams.query), fields),
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
        actions={<LinkButton href={`/t/${params.tenantId}/policies/new`}>Create policy</LinkButton>}
      />
      <MdmTable<PolicyRow>
        rows={rows()}
        loading={policies.isPending}
        error={policies.error}
        storageKey="policies"
        toolbar={
          <EntityQueryBar fields={fields} conditions={conditions()} onChange={updateConditions} />
        }
        onRowClick={(row) => navigate(`/t/${params.tenantId}/policies/${row.id}`)}
        actions={(selected, clear) => (
          <EntityActions entity="policy" selected={selected} clear={clear} />
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
                <LinkButton href={`/t/${params.tenantId}/policies/new`}>Create policy</LinkButton>
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
                <a
                  class="block truncate font-medium hover:underline"
                  href={`/t/${params.tenantId}/policies/${row.id}`}
                >
                  {row.name}
                </a>
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
