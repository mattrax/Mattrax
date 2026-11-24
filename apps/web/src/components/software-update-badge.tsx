import { Badge } from "@mattrax/ui";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { SoftwareUpdateInfo } from "@mattrax/enterprise-domain/client";
import { softwareUpdateReason } from "@mattrax/enterprise-domain/client";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { softwareUpdateLabel } from "~/lib/software-updates";

const tone = (info: SoftwareUpdateInfo) => {
  switch (info.status) {
    case "security_update_required":
      return { variant: "warning" as const, dot: "warning" as const };
    case "update_available":
      return { variant: "info" as const, dot: "info" as const };
    case "up_to_date":
      return { variant: "success" as const, dot: "success" as const };
    default:
      return { variant: "outline" as const, dot: "neutral" as const };
  }
};

/**
 * OS version for the device table.
 *
 * The version itself is the link target; the tooltip carries the build and,
 * for macOS, the published latest/required versions. Only a tracked macOS
 * device is tinted, so Windows and Android never look stale just because the
 * SOFA feed does not cover them.
 */
export function OsVersionTag(props: {
  version?: string | null;
  build?: string | null;
  info?: SoftwareUpdateInfo | null;
}) {
  const version = () => props.version?.trim() || props.info?.currentVersion?.trim() || null;
  const build = () => props.build?.trim() || null;

  const tone = () => {
    switch (props.info?.status) {
      case "security_update_required":
        return "text-warning-foreground";
      case "update_available":
        return "text-info";
      default:
        return "text-muted-foreground";
    }
  };

  const status = () => {
    if (!props.info) return "Not reported";

    if (props.info.status === "unknown")
      return props.info.code === "platform_unsupported" ? "Not tracked" : "Unknown";

    return softwareUpdateLabel(props.info) ?? "Unknown";
  };

  const triggerLabel = () => {
    const current = version() ?? "Not reported";
    const update = props.info?.latestVersion;

    return update && props.info?.status !== "up_to_date"
      ? `OS version ${current}. ${status()}. Latest ${update}.`
      : `OS version ${current}. ${status()}.`;
  };

  return (
    <Tooltip>
      <TooltipTrigger
        as="span"
        tabindex={0}
        class={cn(
          "inline-flex cursor-default items-center gap-1.5 rounded-[5px] text-[12.5px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          tone(),
        )}
        aria-label={triggerLabel()}
      >
        {version() ?? "—"}
        <Show when={props.info?.status === "security_update_required"}>
          <span class="size-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
        </Show>
        <Show when={props.info?.status === "update_available"}>
          <span class="size-1.5 shrink-0 rounded-full bg-info" aria-hidden="true" />
        </Show>
      </TooltipTrigger>
      <TooltipContent class="max-w-64">
        <p class="text-[11px] font-medium">OS version</p>
        <dl class="mt-1.5 space-y-1 text-[11.5px]">
          <div class="flex items-baseline justify-between gap-4">
            <dt class="text-muted-foreground">Current</dt>
            <dd class="font-mono text-foreground">
              {version() ?? "Not reported"}
              {build() ? <span class="text-muted-foreground"> ({build()})</span> : null}
            </dd>
          </div>
          <Show when={props.info?.latestVersion}>
            {(latest) => (
              <div class="flex items-baseline justify-between gap-4">
                <dt class="text-muted-foreground">Latest</dt>
                <dd class="font-mono text-foreground">macOS {latest()}</dd>
              </div>
            )}
          </Show>
          <Show when={props.info?.requiredMinimumVersion}>
            {(required) => (
              <div class="flex items-baseline justify-between gap-4">
                <dt class="text-muted-foreground">Required</dt>
                <dd class="font-mono text-foreground">macOS {required()}</dd>
              </div>
            )}
          </Show>
          <div class="flex items-baseline justify-between gap-4">
            <dt class="text-muted-foreground">Status</dt>
            <dd class="text-foreground">{status()}</dd>
          </div>
        </dl>
        <p class="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {props.info
            ? softwareUpdateReason(props.info)
            : "The device has not reported an OS version."}
        </p>
        <Show when={props.info?.securityInfoUrl}>
          {(href) => (
            <a
              href={href()}
              target="_blank"
              rel="noopener noreferrer"
              class="mt-1.5 inline-flex text-[11.5px] font-medium text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand"
            >
              Security details
            </a>
          )}
        </Show>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The update badge shared by the device header and the overview. Windows and
 * Android render the caller's empty state: the SOFA feed only covers macOS,
 * and a coloured "unknown" badge there would imply the check applies to them.
 */
export function SoftwareUpdateTag(props: {
  info?: SoftwareUpdateInfo | null;
  class?: string;
  empty?: JSX.Element;
}) {
  const label = () => softwareUpdateLabel(props.info);
  const info = () => props.info;

  return (
    <Show when={label()} fallback={props.empty ?? <span class="text-muted-foreground">—</span>}>
      {(text) => (
        <Show when={info()}>
          {(value) => (
            <Tooltip>
              <TooltipTrigger
                as="span"
                tabindex={0}
                class="inline-flex cursor-default rounded-[5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                aria-label={`OS updates: ${text()}. ${softwareUpdateReason(value())}`}
              >
                <Badge variant={tone(value()).variant} dot={tone(value()).dot} class={props.class}>
                  {text()}
                </Badge>
              </TooltipTrigger>
              <TooltipContent class="max-w-64">
                <p class="text-[11px] font-medium">
                  {value().currentVersion
                    ? `macOS ${value().currentVersion}`
                    : "macOS update status"}
                </p>
                <p class="mt-1 text-[11.5px] text-muted-foreground">
                  {softwareUpdateReason(value())}
                </p>
                <Show when={value().latestVersion && value().status !== "up_to_date"}>
                  <p class="mt-1 text-[11.5px]">
                    Latest: <span class="font-medium">macOS {value().latestVersion}</span>
                  </p>
                </Show>
                <Show when={value().securityInfoUrl}>
                  {(href) => (
                    <a
                      href={href()}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="mt-1.5 inline-flex text-[11.5px] font-medium text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand"
                    >
                      Security details
                    </a>
                  )}
                </Show>
              </TooltipContent>
            </Tooltip>
          )}
        </Show>
      )}
    </Show>
  );
}
