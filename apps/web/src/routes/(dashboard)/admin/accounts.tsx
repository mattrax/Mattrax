import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/solid-query";
import { createMemo, createSignal } from "solid-js";
import { isServer } from "@solidjs/web";
import type { AdminAccountInfo, AdminAccountsQuery } from "@mattrax/enterprise-domain/client";
import {
  DataTable,
  EmptyState,
  formatDate,
  Page,
  PageHeader,
  PageSkeleton,
  Panel,
  QueryError,
} from "~/components/mdm/common";
import { Badge } from "@mattrax/ui";
import { Button } from "@mattrax/ui";
import ConfirmDialog from "~/components/ui/confirm-dialog";
import { Input } from "@mattrax/ui";
import { ShieldCheck, UsersRound } from "~/components/ui/icons";
import { toast } from "~/components/toast";
import { AccessDenied } from "~/lib/permissions";
import { authClient } from "~/lib/auth";
import { enterprise, enterpriseKeys, enterpriseQueries, meQueryOptions } from "~/lib/enterprise";
import { errorMessage, raisedFailure } from "~/lib/errors";

const PAGE_SIZE = 25;

export default function AdminAccountsPage() {
  const session = authClient.useSession();
  const queryClient = useQueryClient();
  const me = useQuery(() => meQueryOptions(session().data?.user?.id));
  const allowed = () => me.data?.account.superadmin === true;

  const [draft, setDraft] = createSignal("");
  const [term, setTerm] = createSignal("");
  const [page, setPage] = createSignal(0);
  const [target, setTarget] = createSignal<AdminAccountInfo | null>(null);
  const [pending, setPending] = createSignal(false);
  const [actionError, setActionError] = createSignal<unknown>(null);

  const query = createMemo<AdminAccountsQuery>(() => {
    const q = term();

    return {
      limit: PAGE_SIZE,
      offset: page() * PAGE_SIZE,
      ...(q ? { q } : {}),
    };
  });

  const accounts = useQuery(() => ({
    ...enterpriseQueries.adminAccounts(query()),
    enabled: !isServer && allowed(),
    placeholderData: keepPreviousData,
  }));

  const total = () => accounts.data?.total ?? 0;
  const pageCount = () => Math.max(1, Math.ceil(total() / PAGE_SIZE));

  const submitSearch = (event: SubmitEvent) => {
    event.preventDefault();
    setTerm(draft().trim());
    setPage(0);
  };

  const confirm = async () => {
    const account = target();

    if (!account) return;

    const next = !account.superadmin;

    setPending(true);
    setActionError(null);

    try {
      await enterprise.patchAdminAccountSuperadmin(account.id, next);
      toast.success(next ? "Platform administrator granted" : "Platform administrator removed", {
        description: account.email,
      });
      setTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: enterpriseKeys.adminAccounts(query()) }),
        queryClient.invalidateQueries({ queryKey: enterpriseKeys.me() }),
      ]);
    } catch (error) {
      setActionError(error);
      toast.error("Could not change platform access", {
        description: errorMessage(raisedFailure(error)),
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <Page wide>
      <PageHeader
        eyebrow="Platform"
        title="Platform accounts"
        description="Every account on this deployment, their tenant memberships and platform-operator access. This view is not scoped to a tenant."
      />

      {me.isPending ? (
        <PageSkeleton rows={6} />
      ) : !allowed() ? (
        <AccessDenied
          title="Platform access required"
          message="This page is only available to platform administrators. Ask the deployment operator if you need access."
        />
      ) : (
        <>
          <Panel
            title="Accounts"
            description="Search by name or email. Promoting grants the cross-tenant account catalogue; it does not grant access to any tenant's devices or policies."
          >
            <form class="mb-3 flex flex-wrap items-center gap-2" onSubmit={submitSearch}>
              <div class="min-w-0 flex-1">
                <label class="sr-only" for="admin-account-search">
                  Search accounts
                </label>
                <Input
                  id="admin-account-search"
                  value={draft()}
                  placeholder="Search name or email"
                  autocomplete="off"
                  onInput={(event) => setDraft(event.currentTarget.value)}
                />
              </div>
              <Button type="submit" variant="outline" size="sm">
                Search
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!draft() && !term()}
                onClick={() => {
                  setDraft("");
                  setTerm("");
                  setPage(0);
                }}
              >
                Clear
              </Button>
            </form>

            {accounts.isPending ? (
              <PageSkeleton rows={5} />
            ) : accounts.isError ? (
              <QueryError error={accounts.error} onRetry={() => void accounts.refetch()} />
            ) : (
              <DataTable
                rows={accounts.data ? [...accounts.data.accounts] : undefined}
                caption="Platform accounts and their memberships"
                empty={
                  <EmptyState
                    icon={UsersRound}
                    title={term() ? "No matching accounts" : "No accounts yet"}
                    description={
                      term()
                        ? "No account's name or email matches this search."
                        : "Accounts appear here after the first registration on this deployment."
                    }
                  />
                }
                columns={[
                  {
                    header: "Account",
                    cell: (account) => (
                      <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-1.5">
                          <span class="font-medium text-foreground">{account.name}</span>
                          {account.superadmin ? (
                            <Badge variant="brand">
                              <ShieldCheck class="size-3" aria-hidden="true" />
                              Superadmin
                            </Badge>
                          ) : null}
                          {account.superadminSource === "env" ? (
                            <Badge variant="outline" title="Granted by MATTRAX_SUPERADMINS">
                              Environment-managed
                            </Badge>
                          ) : null}
                        </div>
                        <div class="mt-0.5 truncate text-xs text-muted-foreground">
                          {account.email}
                        </div>
                      </div>
                    ),
                  },
                  {
                    header: "Status",
                    cell: (account) => (
                      <div class="flex flex-wrap gap-1.5">
                        <Badge variant={account.emailVerified ? "success" : "warning"}>
                          {account.emailVerified ? "Verified" : "Unverified"}
                        </Badge>
                        {account.disabled ? <Badge variant="destructive">Disabled</Badge> : null}
                      </div>
                    ),
                  },
                  {
                    header: "Tenants",
                    cell: (account) =>
                      account.memberships.length === 0 ? (
                        <span class="text-muted-foreground">No memberships</span>
                      ) : (
                        <div class="flex flex-col gap-1">
                          {account.memberships.map((membership) => (
                            <span class="flex min-w-0 flex-wrap items-baseline gap-1.5">
                              <span class="truncate text-foreground/90">
                                {membership.tenantName}
                              </span>
                              <span class="inline-block max-w-full truncate">
                                <Badge variant="outline">{membership.roleName}</Badge>
                              </span>
                            </span>
                          ))}
                        </div>
                      ),
                  },
                  {
                    header: "Created",
                    cell: (account) => formatDate(account.createdAt),
                  },
                  {
                    header: "Platform access",
                    class: "text-right",
                    cell: (account) => {
                      const self = () => account.id === me.data?.account.id;
                      const envManaged = () => account.superadminSource === "env";
                      const demoteBlocked = () => account.superadmin && (self() || envManaged());

                      return (
                        <div class="flex justify-end">
                          {envManaged() ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled
                              title="This account is listed in MATTRAX_SUPERADMINS and cannot be demoted here."
                            >
                              Managed by environment
                            </Button>
                          ) : (
                            <Button
                              variant={account.superadmin ? "outline" : "default"}
                              size="sm"
                              disabled={demoteBlocked()}
                              title={
                                self() && account.superadmin
                                  ? "You cannot remove your own platform access."
                                  : undefined
                              }
                              onClick={() => {
                                setActionError(null);
                                setTarget(account);
                              }}
                            >
                              {account.superadmin ? "Demote" : "Promote"}
                            </Button>
                          )}
                        </div>
                      );
                    },
                  },
                ]}
              />
            )}

            <div class="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <span
                role="status"
                aria-live="polite"
                class="text-xs tabular-nums text-muted-foreground"
              >
                Page {page() + 1} of {pageCount()}
                <span>
                  {" "}
                  · {total().toLocaleString()} account{total() === 1 ? "" : "s"}
                </span>
              </span>
              <div class="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page() === 0}
                  onClick={() => setPage((value) => Math.max(0, value - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={(page() + 1) * PAGE_SIZE >= total()}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </Panel>

          <p class="px-1 text-xs leading-relaxed text-muted-foreground">
            Platform administrator access is separate from tenant roles. It never grants access to a
            tenant's devices, policies or members, and a tenant owner is not a platform
            administrator.
          </p>
        </>
      )}

      <ConfirmDialog
        open={target() !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTarget(null);
            setActionError(null);
          }
        }}
        title={target()?.superadmin ? "Remove platform access?" : "Grant platform access?"}
        description={
          target()?.superadmin
            ? `${target()?.email ?? "This account"} will lose access to the cross-tenant account catalogue. Tenant roles are not affected.`
            : `${target()?.email ?? "This account"} will be able to list every account and change platform access on this deployment.`
        }
        confirmLabel={target()?.superadmin ? "Demote" : "Promote"}
        destructive={target()?.superadmin === true}
        pending={pending()}
        error={actionError()}
        onConfirm={() => void confirm()}
      />
    </Page>
  );
}
