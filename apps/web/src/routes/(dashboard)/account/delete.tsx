import { useQuery } from "@tanstack/solid-query";
import { CheckboxField } from "@mattrax/ui";
import { createSignal, For, Show } from "solid-js";
import { Field, Page, PageHeader, Panel } from "~/components/mdm/common";
import { Button } from "@mattrax/ui";
import { Input } from "@mattrax/ui";
import { Skeleton } from "@mattrax/ui";
import { authClient } from "~/lib/auth";
import { enterprise, enterpriseQueries, meQueryOptions } from "~/lib/enterprise";
import { errorMessage, raisedFailure } from "~/lib/errors";
import { routes } from "~/lib/routes";

/**
 * The deletion confirmation is a real route so browser Back, the back link and
 * the in-page Cancel all work, and the account settings queries do not keep
 * running behind a dialog. The server still re-checks every rule.
 */
export default function DeleteAccountPage() {
  const session = authClient.useSession();
  const me = useQuery(() => meQueryOptions(session().data?.user?.id));
  const email = () => me.data?.account.email ?? session().data?.user?.email ?? "";
  const preview = useQuery(() => enterpriseQueries.accountDeletion());
  const [acknowledged, setAcknowledged] = createSignal(false);
  const [confirmEmail, setConfirmEmail] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const emailMatches = () => {
    const expected = email().trim().toLowerCase();

    return expected.length > 0 && confirmEmail().trim().toLowerCase() === expected;
  };

  const remove = async () => {
    setError(null);
    setPending(true);

    try {
      await enterprise.deleteAccount({ confirmEmail: confirmEmail() });
      window.location.href = "/";
    } catch (error_) {
      setError(
        errorMessage(
          raisedFailure(error_),
          "Could not complete account deletion. Nothing else was changed, so your sign-in still works; retry to finish.",
        ),
      );
      void preview.refetch();
    } finally {
      setPending(false);
    }
  };

  return (
    <Page class="max-w-180">
      <Button as="a" variant="ghost" size="sm" class="-ml-2 self-start" href={routes.account()}>
        ← Back to account
      </Button>

      <PageHeader
        eyebrow="Delete account"
        title="Delete your account and tenant"
        description="Account deletion is tenant deletion. Review exactly what will be removed before confirming."
      />

      <Show
        when={preview.data}
        fallback={
          <Show
            when={!preview.error}
            fallback={
              <Panel title="Could not check this account">
                <p role="alert" class="text-xs text-destructive">
                  {errorMessage(
                    raisedFailure(preview.error),
                    "The deletion check is unavailable right now.",
                  )}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  class="mt-3"
                  onClick={() => void preview.refetch()}
                >
                  Try again
                </Button>
              </Panel>
            }
          >
            <Panel title="Checking your account">
              <div class="space-y-2">
                <Skeleton class="h-4 w-2/3" />
                <Skeleton class="h-4 w-1/2" />
                <Skeleton class="h-4 w-3/4" />
              </div>
            </Panel>
          </Show>
        }
      >
        {(check) => (
          <>
            <Panel
              title="What will be deleted"
              description="This list comes from the live tenant, not a cached summary."
            >
              <dl class="grid gap-2 sm:grid-cols-2">
                <div class="rounded-lg border border-border bg-surface px-3 py-2">
                  <dt class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Account
                  </dt>
                  <dd class="mt-0.5 break-all text-xs text-foreground">
                    {email() || "This account"}
                  </dd>
                </div>
                <Show when={check().tenant}>
                  {(tenant) => (
                    <>
                      <div class="rounded-lg border border-border bg-surface px-3 py-2">
                        <dt class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Tenant
                        </dt>
                        <dd class="mt-0.5 text-xs text-foreground">
                          {tenant().name}{" "}
                          <span class="font-mono text-xs text-muted-foreground">
                            {tenant().slug}
                          </span>
                        </dd>
                      </div>
                      <div class="rounded-lg border border-border bg-surface px-3 py-2">
                        <dt class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Members
                        </dt>
                        <dd class="mt-0.5 text-xs tabular-nums text-foreground">
                          {tenant().memberCount}
                        </dd>
                      </div>
                      <div class="rounded-lg border border-border bg-surface px-3 py-2">
                        <dt class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Devices
                        </dt>
                        <dd class="mt-0.5 text-xs tabular-nums text-foreground">
                          {tenant().deviceCount}
                        </dd>
                      </div>
                    </>
                  )}
                </Show>
              </dl>

              <ul class="mt-3 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                <li>
                  The tenant is deleted with your account, including its policies, groups,
                  applications, scripts, audit history and stored files.
                </li>
                <li>
                  Devices are sent an unenroll request. A device that is offline may need its
                  management profile removed by hand.
                </li>
                <li>The tenant's subscription is cancelled during the deletion.</li>
                <li>
                  An account audit entry is kept so the deletion can still be answered later.
                </li>
              </ul>

              <Show when={check().lastAccount}>
                <p class="mt-3 rounded-lg border border-warning/25 bg-warning/[0.07] px-3 py-2 text-xs leading-relaxed text-warning-foreground">
                  This is the last account on this deployment. Sign-up stays open; a new account
                  can create a fresh tenant.
                </p>
              </Show>
            </Panel>

            <Show
              when={check().canDelete}
              fallback={
                <Panel
                  class="border-warning/25 bg-warning/[0.035]"
                  title="This account cannot be deleted yet"
                  description="Nothing has been changed. Clear the following first, then come back."
                >
                  <ul class="space-y-2">
                    <For each={check().blockers}>
                      {(blocker) => (
                        <li class="flex gap-2 text-xs leading-relaxed text-warning-foreground">
                          <span aria-hidden="true" class="mt-0.75 size-1.5 rounded-full bg-warning" />
                          <span>{blocker.message}</span>
                        </li>
                      )}
                    </For>
                  </ul>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <Show when={check().tenant}>
                      {(tenant) => (
                        <Button
                          as="a"
                          href={routes.tenant(tenant().id).settingsAdministrators()}
                          size="sm"
                          variant="outline"
                        >
                          Open administrators
                        </Button>
                      )}
                    </Show>
                    <Button as="a" href={routes.tenants()} size="sm" variant="outline">
                      View tenants
                    </Button>
                  </div>
                </Panel>
              }
            >
              <Panel
                class="border-destructive/25 bg-destructive/[0.025]"
                title="Confirm deletion"
                description="This is the last step. The account and tenant are removed immediately."
              >
                <Field
                  label="Type your email address to confirm"
                  hint={email() ? `The account is ${email()}.` : undefined}
                >
                  <Input
                    type="email"
                    autocomplete="email"
                    value={confirmEmail()}
                    onInput={(event) => setConfirmEmail(event.currentTarget.value)}
                  />
                </Field>

                <CheckboxField
                  class="mt-2"
                  checked={acknowledged()}
                  onCheckedChange={setAcknowledged}
                  disabled={!emailMatches() || pending()}
                  label={
                    check().tenant
                      ? `I understand that deleting my account also deletes ${check().tenant!.name} and cannot be undone.`
                      : "I understand that deleting my account cannot be undone."
                  }
                  description="The tenant's devices, policies, audit history, stored files and subscription are deleted with it."
                />

                <Show when={error()}>
                  {(message) => (
                    <p role="alert" class="mt-2 text-xs leading-relaxed text-destructive">
                      {message()}
                    </p>
                  )}
                </Show>

                <div class="mt-3 flex flex-wrap gap-2">
                  <Button as="a" variant="outline" size="sm" href={routes.account()}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={!emailMatches() || !acknowledged() || pending()}
                    onClick={() => void remove()}
                  >
                    {pending() ? "Deleting…" : "Delete account and tenant"}
                  </Button>
                </div>
              </Panel>
            </Show>
          </>
        )}
      </Show>
    </Page>
  );
}
