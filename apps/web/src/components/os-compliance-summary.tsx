import { useQuery } from "@tanstack/solid-query";
import { Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { enterpriseQueries } from "~/lib/enterprise";
import { useCan } from "~/lib/permissions";
import { routes } from "~/lib/routes";

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  count === 1 ? singular : pluralForm;

/**
 * Overview summary of tenant OS-version compliance.
 *
 * It is intentionally quieter than the macOS update banner: compliance covers
 * three platform families, and a device that meets the configured minimum is
 * not necessarily on the newest release (Windows and Android have no feed). The
 * OS updates settings carry the explanation and the minimum-version controls.
 */
/** Read secondary query data only after success so pending async values never throw or suspend during render. */
function settledQueryData<T>(query: {
  readonly isSuccess: boolean;
  readonly data: T | undefined;
}): T | undefined {
  return query.isSuccess ? query.data : undefined;
}

export function OsComplianceSummary(props: { tenantId: string }) {
  const { can } = useCan();

  const fleet = useQuery(() => ({
    ...enterpriseQueries.osFleet(props.tenantId),
    enabled: can("devices.read"),
  }));

  const totals = () => settledQueryData(fleet)?.totals;
  const configured = () =>
    (settledQueryData(fleet)?.platforms ?? []).some((entry) => entry.minimumVersion);
  const attention = () => (totals()?.belowMinimum ?? 0) + (totals()?.updateAvailable ?? 0);

  return (
    <Show when={can("devices.read") && settledQueryData(fleet)}>
      <section
        class="rounded-xl border border-border bg-card p-3.5 shadow-card"
        aria-label="OS version compliance"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-[12.5px] font-[560] text-foreground">OS version compliance</p>
            <p class="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
              <Show
                when={configured()}
                fallback="No minimum version is configured yet. Set one to see who is behind."
              >
                {totals()?.compliant ?? 0} {plural(totals()?.compliant ?? 0, "device")} compliant
                {attention() > 0 ? ` · ${attention()} need attention` : ""}
                {(totals()?.unknown ?? 0) > 0 ? ` · ${totals()?.unknown ?? 0} unknown` : ""}
              </Show>
            </p>
          </div>
          <Button
            as="a"
            href={routes.tenant(props.tenantId).settingsTab("os-updates")}
            size="xs"
            variant="outline"
          >
            OS updates
          </Button>
        </div>

        <div class="mt-3 grid grid-cols-3 gap-2">
          {[
            { label: "Compliant", value: totals()?.compliant ?? 0, tone: "text-success" },
            {
              label: "Below minimum",
              value: totals()?.belowMinimum ?? 0,
              tone: (totals()?.belowMinimum ?? 0) > 0 ? "text-warning" : undefined,
            },
            { label: "Unknown", value: totals()?.unknown ?? 0 },
          ].map((item) => (
            <div class="rounded-lg border border-border/70 px-2.5 py-1.5">
              <p class="text-[10px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
                {item.label}
              </p>
              <p
                class={`mt-0.5 text-[15px] font-[560] tabular-nums ${item.tone ?? "text-foreground"}`}
              >
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </section>
    </Show>
  );
}
