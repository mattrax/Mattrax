import { createEffect, createSignal, For, Show } from "solid-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import type { AppleByodConfigInfo } from "@mattrax/enterprise-domain/client";
import { ErrorText, Panel } from "~/components/mdm/common";
import { Button } from "@mattrax/ui";
import { Info } from "~/components/ui/icons";
import Chip from "~/components/settings/status-chip";
import { toast } from "~/components/toast";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import { Input } from "@mattrax/ui";

const copy = async (value: string | undefined, label: string) => {
  if (!value) return;

  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Could not copy the ${label.toLowerCase()}`);
  }
};

/**
 * Setup surface for Apple account-driven User Enrollment (BYOD).
 *
 * The discovery document can only answer on a domain the tenant controls and
 * has pointed at this deployment, so this panel does not pretend a verified
 * email domain is enough. It shows the exact document, the public test result
 * and the real-device validation gate.
 */
export default function AppleByodPanel(props: {
  readonly tenantId: string;
  readonly canWrite: boolean;
}) {
  const qc = useQueryClient();
  const config = useQuery(() => enterpriseQueries.appleByod(props.tenantId));

  const [domain, setDomain] = createSignal<string | null>(null);
  const [enabled, setEnabled] = createSignal(false);
  const [hardwareRequired, setHardwareRequired] = createSignal(true);

  createEffect(
    () => config.data,
    (data) => {
      if (!data) return;
      setDomain(data.domain ?? null);
      setEnabled(data.enabled);
      setHardwareRequired(data.hardwareValidationRequired);
    },
  );

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: enterpriseKeys.appleByod(props.tenantId) });

  const save = useMutation(() => ({
    mutationFn: () =>
      enterprise.patchAppleByodConfig(props.tenantId, {
        enabled: enabled(),
        domain: domain(),
        hardwareValidationRequired: hardwareRequired(),
      }),
    onSuccess: (data: AppleByodConfigInfo) => {
      qc.setQueryData(enterpriseKeys.appleByod(props.tenantId), data);
      toast.success("Apple BYOD settings saved");
    },
    onSettled: () => void invalidate(),
  }));

  const test = useMutation(() => ({
    mutationFn: () => enterprise.testAppleByodConfig(props.tenantId, domain()),
    onSuccess: (result: { ok: boolean; errors: ReadonlyArray<string> }) => {
      if (result.ok) toast.success("Discovery document verified over the public origin");
      else toast.error("The discovery test failed. Review the problems below.");
    },
    onSettled: () => void invalidate(),
  }));

  const confirmHardware = useMutation(() => ({
    mutationFn: (validated: boolean) =>
      enterprise.confirmAppleByodHardware(props.tenantId, validated),
    onSuccess: (data: AppleByodConfigInfo) => {
      qc.setQueryData(enterpriseKeys.appleByod(props.tenantId), data);
      toast.success(
        data.hardwareValidatedAt ? "Real-device validation recorded" : "Validation withdrawn",
      );
    },
    onSettled: () => void invalidate(),
  }));

  const disabled = () => !props.canWrite || save.isPending;
  const data = () => config.data;

  return (
    <Panel
      title="Apple account-driven enrollment (BYOD)"
      description="Personally owned iPhone and iPad enrollment from Settings, using a Managed Apple Account and this tenant's single sign-on. Preview: validate on a real device before enabling."
      actions={
        <Chip tone={data()?.enabled ? "success" : "neutral"}>
          {data()?.enabled ? "Enabled" : "Disabled"}
        </Chip>
      }
    >
      <p class="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/[0.06] p-3 text-xs leading-relaxed text-warning-foreground">
        <Info class="mt-px size-3.5 shrink-0" />
        <span>
          This flow cannot be proven by unit tests alone. Complete a real account-driven enrollment
          on an iPhone or iPad with a Managed Apple Account before letting users rely on it. Until
          then, keep "Require real-device validation" on and the discovery document answers 403.
        </span>
      </p>

      <Show when={config.isError}>
        <div class="mt-3">
          <ErrorText error={config.error} />
        </div>
      </Show>

      <Show when={data()}>
        {(info) => (
          <div class="mt-4 space-y-4">
            <div class="grid gap-3 sm:grid-cols-3">
              <div class="rounded-lg border border-border p-3">
                <p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Domain
                </p>
                <p class="mt-1 break-all text-xs font-medium text-foreground">
                  {info().domain ?? "Not selected"}
                </p>
              </div>
              <div class="rounded-lg border border-border p-3">
                <p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Public test
                </p>
                <p class="mt-1 text-xs font-medium text-foreground">
                  {info().validatedAt
                    ? `Passed ${new Date(info().validatedAt!).toLocaleString()}`
                    : "Not verified"}
                </p>
              </div>
              <div class="rounded-lg border border-border p-3">
                <p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Real device
                </p>
                <p class="mt-1 text-xs font-medium text-foreground">
                  {info().hardwareValidatedAt
                    ? `Validated ${new Date(info().hardwareValidatedAt!).toLocaleDateString()}`
                    : info().hardwareValidationRequired
                      ? "Required"
                      : "Not required"}
                </p>
              </div>
            </div>

            <Show
              when={info().domains.length > 0}
              fallback={
                <div class="rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed text-muted-foreground">
                  No verified domain is available. Connect Microsoft Entra single sign-on, run
                  directory sync and confirm a verified domain under{" "}
                  <a
                    class="font-medium underline underline-offset-2"
                    href={`/t/${props.tenantId}/settings/identity/domains`}
                  >
                    Settings → Identity → Domains
                  </a>
                  . Account-driven enrollment cannot be hosted without one.
                </div>
              }
            >
              <div class="grid gap-3 sm:grid-cols-2">
                <label class="block text-xs font-medium text-foreground">
                  Managed Apple Account domain
                  <select
                    class="mt-1.5 min-h-9 w-full rounded-lg border border-border bg-background px-2 text-xs"
                    disabled={disabled()}
                    value={domain() ?? ""}
                    onChange={(event) => setDomain(event.currentTarget.value || null)}
                  >
                    <option value="">Select a verified domain</option>
                    <For each={info().domains}>
                      {(option) => (
                        <option value={option.domain}>
                          {option.domain}
                          {option.source === "deployment" ? " (this deployment)" : ""}
                        </option>
                      )}
                    </For>
                  </select>
                </label>

                <div class="flex flex-col justify-end gap-2 sm:flex-row sm:items-end">
                  <label class="flex min-h-9 items-center gap-2 text-xs text-foreground">
                    <Input
                      type="checkbox"
                      checked={enabled()}
                      disabled={disabled()}
                      onChange={(event) => setEnabled(event.currentTarget.checked)}
                    />
                    Enable account-driven enrollment
                  </label>
                </div>
              </div>

              <label class="flex items-start gap-2 text-xs text-foreground">
                <Input
                  class="mt-0.5"
                  type="checkbox"
                  checked={hardwareRequired()}
                  disabled={disabled()}
                  onChange={(event) => setHardwareRequired(event.currentTarget.checked)}
                />
                <span>
                  Require real-device validation before the discovery document is exposed
                  <span class="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    Turn this off only while setting up and testing. Turn it back on once an iPhone
                    or iPad has completed the flow.
                  </span>
                </span>
              </label>

              <div class="flex flex-wrap gap-2">
                <Button disabled={disabled()} onClick={() => save.mutate()}>
                  {save.isPending ? "Saving…" : "Save BYOD settings"}
                </Button>
                <Button
                  variant="outline"
                  disabled={save.isPending || test.isPending || !info().domain}
                  onClick={() => test.mutate()}
                >
                  {test.isPending ? "Testing…" : "Test discovery document"}
                </Button>
              </div>
            </Show>

            <Show when={info().wellKnownUrl}>
              {(wellKnownUrl) => (
                <div class="space-y-3 rounded-lg border border-border p-3">
                  <div>
                    <p class="text-xs font-medium text-foreground">
                      DNS and discovery prerequisite
                    </p>
                    <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Point <code class="break-all">{info().domain}</code> at this deployment (
                      {new URL(info().deploymentOrigin).host}) with a CNAME, ALIAS or A/AAAA record.
                      The domain must serve this document over HTTPS; the apex of the Managed Apple
                      Account domain is what Apple queries. Mattrax cannot verify DNS answers, so
                      the test below fetches the public URL exactly as a device would.
                    </p>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <code class="min-w-0 flex-1 break-all rounded bg-surface px-2 py-1.5 text-xs">
                      {wellKnownUrl()}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void copy(wellKnownUrl(), "Discovery URL")}
                    >
                      Copy URL
                    </Button>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <code class="min-w-0 flex-1 break-all rounded bg-surface px-2 py-1.5 text-xs">
                      CNAME {info().domain} → {new URL(info().deploymentOrigin).host}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void copy(
                          `CNAME ${info().domain} → ${new URL(info().deploymentOrigin).host}`,
                          "DNS record",
                        )
                      }
                    >
                      Copy DNS
                    </Button>
                  </div>
                  <div>
                    <p class="text-xs font-medium text-foreground">Expected response</p>
                    <div class="mt-1 flex flex-wrap items-start gap-2">
                      <pre class="min-w-0 flex-1 overflow-x-auto rounded bg-surface p-2 text-xs leading-relaxed">
                        {info().expectedDocument}
                      </pre>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void copy(info().expectedDocument ?? undefined, "Discovery document")
                        }
                      >
                        Copy JSON
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </Show>

            <Show when={info().blockers.length > 0}>
              <div class="rounded-lg border border-warning/25 bg-warning/[0.06] p-3">
                <p class="text-xs font-medium text-warning-foreground">
                  Before this can be enabled
                </p>
                <ul class="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-warning-foreground">
                  <For each={info().blockers}>{(blocker) => <li>{blocker}</li>}</For>
                </ul>
              </div>
            </Show>

            <Show when={info().hosted}>
              <p class="rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed text-muted-foreground">
                This is a Mattrax Cloud deployment. Per-tenant custom hostnames are not available
                yet (issues 460 and 526), so account-driven enrollment needs a self-hosted deployment on the
                organisation's verified domain.
              </p>
            </Show>

            <Show when={test.data && !test.data.ok && test.data.errors.length > 0}>
              <div class="rounded-lg border border-destructive/20 bg-destructive/10 p-3 dark:bg-destructive/10">
                <p class="text-xs font-medium text-destructive dark:text-destructive">
                  Discovery test failed
                </p>
                <ul class="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-destructive dark:text-destructive">
                  <For each={test.data!.errors}>{(problem) => <li>{problem}</li>}</For>
                </ul>
                <Show when={(test.data as { body?: string | null } | undefined)?.body}>
                  <pre class="mt-2 max-h-32 overflow-auto rounded bg-background/60 p-2 text-xs">
                    {(test.data as { body?: string | null }).body}
                  </pre>
                </Show>
              </div>
            </Show>

            <ErrorText error={save.error ?? test.error ?? confirmHardware.error} />

            <div class="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button
                variant="outline"
                disabled={disabled() || confirmHardware.isPending || !info().domain}
                onClick={() => confirmHardware.mutate(!info().hardwareValidatedAt)}
              >
                {info().hardwareValidatedAt
                  ? "Withdraw real-device validation"
                  : "Mark real-device validation complete"}
              </Button>
              <p class="text-xs leading-relaxed text-muted-foreground">
                Only tick this after an iPhone or iPad with a Managed Apple Account completes the
                flow against this tenant. It is an audit record, not a test.
              </p>
            </div>

            <p class="text-xs leading-relaxed text-muted-foreground">
              Limits: only Microsoft Entra SSO is implemented; Google Workspace sign-in is not.
              Federated Managed Apple Accounts must match the IdP email address. Apple must reach
              the discovery document publicly over HTTPS, and this deployment must own that
              hostname's DNS and certificate.
            </p>
          </div>
        )}
      </Show>
    </Panel>
  );
}
