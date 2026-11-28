import { useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { For, Show, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { MergeDuplicateNotice, MergeUsersDialog } from "~/components/mdm/merge-users";
import {
  EmptyState,
  ErrorText,
  Page,
  PageBreadcrumbs,
  PageSkeleton,
  Panel,
  formatDate,
} from "~/components/mdm/common";
import { Badge } from "@mattrax/ui";
import { Button } from "@mattrax/ui";
import {
  ArrowUpRight,
  Laptop,
  ShieldCheck,
  User as UserIcon,
  UsersRound,
} from "~/components/ui/icons";
import { Card, CardContent } from "@mattrax/ui";
import { enterpriseQueries } from "~/lib/enterprise";
import type { UserDetail, UserPolicyAssignment, UserGroupRef } from "~/lib/enterprise";
import { initials } from "~/lib/names";
import { preloadPage } from "~/lib/page-data";
import { useCan } from "~/lib/permissions";
import { queryClient } from "~/lib/query-client";
import { routes } from "~/lib/routes";

/**
 * The user view: the same directory person, device links and policy
 * assignment edges that the directory, device and policy pages expose,
 * gathered around the person instead of the resource.
 *
 * The only mutation here is the duplicate repair: two directory rows that
 * describe the same person, usually because the provider recreated them, can be
 * folded into one. Group membership is otherwise managed by directory sync (or
 * the directory page) and device links by the device page, so the page links
 * into the owners of each piece of data.
 */
export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial" || !params.tenantId || !params.userId) return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.user(params.tenantId, params.userId)),
    ]);
  },
};

const SOURCE_LABELS: Record<UserDetail["source"], string> = {
  entra: "Microsoft Entra ID",
  google: "Google Workspace",
  scim: "SCIM",
  manual: "Created manually",
};

const PLATFORM_LABELS: Record<"apple" | "win" | "android", string> = {
  apple: "Apple",
  win: "Windows",
  android: "Android",
};

const GROUP_SOURCE_LABELS: Record<UserGroupRef["source"], string> = {
  graph: "Entra ID",
  google: "Google Workspace",
  scim: "SCIM",
  manual: "Manual",
};

/**
 * The API builds this from the provider registry, so the dashboard does not
 * need a source-specific URL for every future provider. SCIM and manually
 * created people have no portable record URL and return null.
 */
const externalIdentityUrl = (user: UserDetail): string | undefined => user.externalUrl ?? undefined;

/** Label for the provider whose admin console the link opens. */
const externalIdentityLabel = (user: UserDetail): string =>
  user.source === "google" ? "Open in Google Admin" : "Open in Entra";

function FactRow(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-1 py-2.5 sm:flex-row sm:gap-3">
      <dt class="w-full shrink-0 text-xs font-medium text-muted-foreground sm:w-38 lg:w-44">
        {props.label}
      </dt>
      <dd class="min-w-0 flex-1 break-words text-xs text-foreground">{props.children}</dd>
    </div>
  );
}

function SourceBadge(props: { source: UserGroupRef["source"] }) {
  return (
    <span class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {GROUP_SOURCE_LABELS[props.source]}
    </span>
  );
}

/** One policy assignment with the grant edges that contribute it. */
function PolicyRow(props: {
  tenantId: string | undefined;
  policy: UserPolicyAssignment;
  canReadPolicies: boolean;
}) {
  return (
    <li class="px-4 py-3">
      <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div class="min-w-0">
          <Show
            when={props.canReadPolicies}
            fallback={
              <span class="block truncate text-xs font-medium text-foreground">
                {props.policy.policyName}
              </span>
            }
          >
            <a
              href={routes.tenant(props.tenantId).policy(props.policy.policyId)}
              class="block truncate text-xs font-medium text-foreground hover:underline"
            >
              {props.policy.policyName}
            </a>
          </Show>
          <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            <Show when={props.policy.direct}>Assigned directly</Show>
            <Show when={props.policy.direct && props.policy.groups.length > 0}> · </Show>
            <Show when={props.policy.groups.length > 0}>
              Via{" "}
              <For each={props.policy.groups}>
                {(group, index) => (
                  <>
                    <Show when={index() > 0}>, </Show>
                    <span class="font-medium text-foreground/85">{group.name}</span>
                  </>
                )}
              </For>
            </Show>
            <Show when={!props.policy.direct && props.policy.groups.length === 0}>
              No assignment edge
            </Show>
          </p>
          <Show when={props.policy.overriddenExclusions.length > 0}>
            <p class="mt-0.5 text-xs leading-relaxed text-warning-foreground">
              The direct assignment overrides an exclusion from{" "}
              <For each={props.policy.overriddenExclusions}>
                {(group, index) => (
                  <>
                    <Show when={index() > 0}>, </Show>
                    {group.name}
                  </>
                )}
              </For>
              .
            </p>
          </Show>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <Show when={props.policy.direct}>
            <Badge variant="outline">Direct</Badge>
          </Show>
          <span class="text-xs tabular-nums text-muted-foreground">
            priority {props.policy.priority}
          </span>
        </div>
      </div>
    </li>
  );
}

export default function UserDetailPage() {
  const params = useParams();
  const { can } = useCan();

  const user = useQuery(() => enterpriseQueries.user(params.tenantId, params.userId));
  const data = () => user.data;
  const [mergeOpen, setMergeOpen] = createSignal(false);

  // Only a caller who can merge pays for the suggestion query. It is the same
  // tenant audit history the merge writes, so a recreated duplicate surfaces on
  // this page without a second alias store.
  const mergeCandidates = useQuery(() => ({
    ...enterpriseQueries.userMergeCandidates(params.tenantId, params.userId),
    enabled: can("members.write"),
  }));

  const externalUrl = () => {
    const value = data();

    return value ? externalIdentityUrl(value) : undefined;
  };

  const groupsHref = () => routes.tenant(params.tenantId).settingsDirectory();

  return (
    <Page>
      <Show
        when={data()}
        fallback={
          <Show when={user.isError} fallback={<PageSkeleton rows={7} />}>
            <Card>
              <CardContent>
                <div class="flex flex-col items-start gap-3">
                  <div class="min-w-0">
                    <p class="text-xs font-medium text-foreground">
                      This user could not be loaded
                    </p>
                    <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                      They may have been removed by directory sync, or you may not have access to
                      this tenant.
                    </p>
                  </div>
                  <ErrorText error={user.error} />
                  <div class="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={user.isFetching}
                      onClick={() => void user.refetch()}
                    >
                      {user.isFetching ? "Retrying…" : "Try again"}
                    </Button>
                    <Button
                      as="a"
                      size="sm"
                      variant="outline"
                      href={routes.tenant(params.tenantId).users()}
                    >
                      Back to users
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Show>
        }
      >
        {(value) => (
          <>
            <section class="relative overflow-hidden rounded-xl border border-border bg-card shadow-card">
              <div class="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
                <div class="flex min-w-0 items-start gap-4">
                  <span
                    class="flex size-12 shrink-0 items-center justify-center rounded-full bg-hover text-sm font-semibold text-foreground"
                    aria-hidden="true"
                  >
                    {initials(value().name)}
                  </span>
                  <div class="min-w-0 pt-0.5">
                    <PageBreadcrumbs title={value().name} />
                    <h1 class="truncate text-xl font-semibold leading-tight tracking-tight text-foreground sm:text-2xl">
                      {value().name}
                    </h1>
                    <p class="mt-1 truncate text-xs leading-5 text-muted-foreground">
                      {value().email}
                    </p>
                    <div class="mt-3 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">{SOURCE_LABELS[value().source]}</Badge>
                      <Show
                        when={!value().disabled}
                        fallback={<Badge variant="outline">Disabled</Badge>}
                      >
                        <Badge variant="success">Active</Badge>
                      </Show>
                      <Show
                        when={value().linked}
                        fallback={<Badge variant="outline">Not linked for SSO</Badge>}
                      >
                        <Badge variant="brand">SSO linked</Badge>
                      </Show>
                    </div>
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-2 lg:justify-end">
                  <Show when={can("members.write")}>
                    <Button variant="outline" size="sm" onClick={() => setMergeOpen(true)}>
                      Merge duplicate
                    </Button>
                  </Show>
                  <Show when={externalUrl()}>
                    {(href) => (
                      <Button
                        as="a"
                        variant="outline"
                        size="sm"
                        href={href()}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {externalIdentityLabel(value())}
                        <ArrowUpRight class="size-3.5" />
                      </Button>
                    )}
                  </Show>
                  <Button
                    as="a"
                    variant="outline"
                    size="sm"
                    href={routes.tenant(params.tenantId).users()}
                  >
                    All users
                  </Button>
                </div>
              </div>
            </section>

            <Show when={value().disabled}>
              <div
                role="status"
                class="rounded-xl border border-warning/25 bg-warning/[0.07] px-4 py-3 text-xs leading-relaxed text-warning-foreground"
              >
                This person is disabled. Directory sync disables a leaver instead of deleting them,
                so their groups, device links and policy assignments stay visible for reference, but
                no user-scoped policy is delivered.
              </div>
            </Show>

            <Show when={(mergeCandidates.data?.candidates.length ?? 0) > 0}>
              <MergeDuplicateNotice
                candidates={mergeCandidates.data?.candidates ?? []}
                onOpen={() => setMergeOpen(true)}
              />
            </Show>

            <div class="flex flex-col items-start gap-4 lg:flex-row">
              <div class="min-w-0 w-full flex-1 space-y-4">
                <Panel
                  title="Identity"
                  description="The directory record this tenant imported. Sync owns these fields; Mattrax never edits them."
                >
                  <dl class="divide-y divide-border">
                    <FactRow label="Email">{value().email}</FactRow>
                    <FactRow label="Directory source">{SOURCE_LABELS[value().source]}</FactRow>
                    <FactRow label="External ID">
                      <Show
                        when={value().externalId}
                        fallback={
                          <span class="text-muted-foreground">Not reported by the directory</span>
                        }
                      >
                        {(externalId) => (
                          <span class="font-mono text-xs break-all">{externalId()}</span>
                        )}
                      </Show>
                    </FactRow>
                    <FactRow label="SSO account">
                      <Show
                        when={value().linkedAccount}
                        fallback={
                          <span class="text-muted-foreground">
                            No Mattrax account is linked. The person can still be assigned policy
                            while they are a directory user.
                          </span>
                        }
                      >
                        {(account) => (
                          <span class="flex flex-col">
                            <span class="font-medium">{account().name}</span>
                            <span class="text-xs text-muted-foreground">
                              {account().email}
                            </span>
                          </span>
                        )}
                      </Show>
                    </FactRow>
                    <FactRow label="Added">{formatDate(value().createdAt)}</FactRow>
                    <FactRow label="Last updated">{formatDate(value().updatedAt)}</FactRow>
                  </dl>
                </Panel>

                <Show when={value().devices}>
                  {(devices) => (
                    <Panel
                      title="Linked devices"
                      description="Devices this person is linked to. User policy is scoped to these devices through the link."
                      flush
                    >
                      <Show
                        when={devices().length > 0}
                        fallback={
                          <div class="p-4">
                            <EmptyState
                              icon={Laptop}
                              title="No linked devices"
                              description="Link a directory user to a device from that device's page to scope their user policy to it."
                            />
                          </div>
                        }
                      >
                        <ul class="divide-y divide-border">
                          <For each={devices()}>
                            {(device) => (
                              <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                                <a
                                  href={routes.tenant(params.tenantId).device(device.id)}
                                  class="min-w-0 flex-1 truncate text-xs font-medium text-foreground hover:underline"
                                >
                                  {device.name}
                                </a>
                                <span class="text-xs text-muted-foreground">
                                  {PLATFORM_LABELS[device.proto]}
                                </span>
                                <Badge variant="outline">{device.status}</Badge>
                                <span
                                  class="text-xs text-muted-foreground"
                                  title={`Linked ${formatDate(device.linkedAt)}`}
                                >
                                  {device.source === "directory" ? "Directory link" : "Manual link"}
                                </span>
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                    </Panel>
                  )}
                </Show>

                <Show when={value().policies}>
                  {(policies) => (
                    <Panel
                      title="Policy assignments"
                      description="Policies granted directly to this person or through a directory group above. This is assignment scope: device-level excludes and configuration conflicts are resolved per device."
                      flush
                    >
                      <Show
                        when={policies().length > 0}
                        fallback={
                          <div class="p-4">
                            <EmptyState
                              icon={ShieldCheck}
                              title="No policy assignments"
                              description="Assign a policy to this person or one of their directory groups. Policies assigned to a device group appear on that device instead."
                            />
                          </div>
                        }
                      >
                        <ul class="divide-y divide-border">
                          <For each={policies()}>
                            {(policy) => (
                              <PolicyRow
                                tenantId={params.tenantId}
                                policy={policy}
                                canReadPolicies={can("policies.read")}
                              />
                            )}
                          </For>
                        </ul>
                      </Show>
                    </Panel>
                  )}
                </Show>
              </div>

              <div class="min-w-0 w-full shrink-0 space-y-4 lg:w-90">
                <Panel
                  title="Directory groups"
                  description="Groups that scope policy for this person. Membership follows the directory; a manual group is maintained by an administrator."
                  actions={
                    <Show when={can("identity.read")}>
                      <a
                        href={groupsHref()}
                        class="text-xs font-medium text-brand underline underline-offset-2 hover:text-brand/80"
                      >
                        Manage
                      </a>
                    </Show>
                  }
                  flush
                >
                  <Show
                    when={value().groups.length > 0}
                    fallback={
                      <div class="p-4">
                        <EmptyState
                          icon={UsersRound}
                          title="No groups"
                          description="This person is not a member of a directory group, so only direct assignments scope policy to them."
                        />
                      </div>
                    }
                  >
                    <ul class="divide-y divide-border">
                      <For each={value().groups}>
                        {(group) => (
                          <li class="flex items-center gap-2 px-4 py-2.5">
                            <Show
                              when={can("identity.read")}
                              fallback={
                                <span class="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                                  {group.name}
                                </span>
                              }
                            >
                              <a
                                href={groupsHref()}
                                class="min-w-0 flex-1 truncate text-xs font-medium text-foreground hover:underline"
                                title="Directory groups are listed in Settings, Identity, Directory"
                              >
                                {group.name}
                              </a>
                            </Show>
                            <SourceBadge source={group.source} />
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </Panel>

                <div class="rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                  <p class="flex items-start gap-2">
                    <UserIcon class="mt-px size-3.5 shrink-0" />
                    <span>
                      Directory data is read-only here. Manage membership and single sign-on in the
                      directory settings, and device links on each device.
                    </span>
                  </p>
                </div>
              </div>
            </div>

            <MergeUsersDialog open={mergeOpen()} onOpenChange={setMergeOpen} target={value()} />
          </>
        )}
      </Show>
    </Page>
  );
}
