import { type RoutePreloadFuncArgs, useParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { Show } from "solid-js";
import { EmptyState, LinkButton, Page, PageHeader } from "~/components/mdm/common";
import { MdmTable, type MdmColumn } from "~/components/mdm/table";
import { User } from "~/components/ui/icons";
import { enterpriseQueries, type UserListRow } from "~/lib/enterprise";
import { preloadPage } from "~/lib/page-data";
import { useCan } from "~/lib/permissions";
import { queryClient } from "~/lib/query-client";
import { routes } from "~/lib/routes";

const SOURCE_LABELS: Record<UserListRow["source"], string> = {
  entra: "Entra ID",
  scim: "SCIM",
  manual: "Manual",
};

/**
 * The tenant's directory people.
 *
 * This is the same data Settings -> Identity -> Directory lists, but focused on
 * the person rather than the sync: each row links to the user view, which shows
 * their groups, linked devices and user-scoped policies. Editing still belongs
 * to the directory and device pages, so the table offers no bulk actions.
 */
export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial" || !params.tenantId) return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.users(params.tenantId)),
    ]);
  },
};

export default function UsersPage() {
  const params = useParams();
  const { can } = useCan();

  const users = useQuery(() => enterpriseQueries.users(params.tenantId));
  const rows = () => users.data?.rows ?? [];

  /** The device column is only meaningful to a role that can read devices. */
  const columns = (): MdmColumn<UserListRow>[] => {
    const all: MdmColumn<UserListRow>[] = [
      {
        id: "name",
        header: "Name",
        sort: (row) => row.name,
        search: (row) => row.name,
        cell: (row) => (
          <div class="min-w-0">
            <a
              href={routes.tenant(params.tenantId).user(row.id)}
              class="block truncate font-medium text-foreground hover:underline"
            >
              {row.name}
            </a>
            <span class="mt-0.5 block truncate text-[11px] text-muted-foreground">{row.email}</span>
          </div>
        ),
      },
      {
        id: "email",
        header: "Email",
        defaultHidden: true,
        sort: (row) => row.email,
        search: (row) => row.email,
        cell: (row) => (
          <span class="truncate text-[12.5px] text-muted-foreground">{row.email}</span>
        ),
      },
      {
        id: "source",
        header: "Source",
        sort: (row) => row.source,
        search: (row) => SOURCE_LABELS[row.source],
        cell: (row) => (
          <span class="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
            {SOURCE_LABELS[row.source]}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        sort: (row) => (row.disabled ? "disabled" : "active"),
        cell: (row) => (
          <span class="flex flex-wrap items-center gap-1.5">
            <span
              class={
                row.disabled
                  ? "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                  : "inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success-foreground"
              }
            >
              <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
              {row.disabled ? "Disabled" : "Active"}
            </span>
            <Show when={row.linked}>
              <span
                class="inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand"
                title="This directory person is linked to a Mattrax account for single sign-on"
              >
                SSO linked
              </span>
            </Show>
          </span>
        ),
      },
      {
        id: "groups",
        header: "Groups",
        sort: (row) => row.groupCount,
        cell: (row) => <span class="tabular-nums text-foreground">{row.groupCount}</span>,
      },
    ];

    if (can("devices.read"))
      all.push({
        id: "devices",
        header: "Devices",
        sort: (row) => row.deviceCount ?? 0,
        cell: (row) => <span class="tabular-nums text-foreground">{row.deviceCount ?? 0}</span>,
      });

    return all;
  };

  return (
    <Page>
      <PageHeader
        title="Users"
        description="Directory people imported from Entra ID or SCIM. Open a person to see their groups, linked devices and the policies scoped to them."
        actions={
          <Show when={can("identity.read")}>
            <LinkButton variant="outline" href={routes.tenant(params.tenantId).settingsDirectory()}>
              Directory sync
            </LinkButton>
          </Show>
        }
      />
      <MdmTable<UserListRow>
        rows={rows()}
        columns={columns()}
        loading={users.isPending}
        isFetching={users.isFetching}
        onRefresh={() => void users.refetch()}
        error={users.error}
        storageKey="users"
        searchPlaceholder="Search users by name or email…"
        caption="Directory users"
        rowHref={(row) => routes.tenant(params.tenantId).user(row.id)}
        empty={
          <EmptyState
            icon={User}
            title="No directory users"
            description="Users arrive from Microsoft Entra ID or SCIM directory sync. Once a user is imported they appear here with their groups and devices."
            action={
              <Show when={can("identity.read")}>
                <LinkButton href={routes.tenant(params.tenantId).settingsDirectory()}>
                  Set up directory sync
                </LinkButton>
              </Show>
            }
          />
        }
      />
    </Page>
  );
}
