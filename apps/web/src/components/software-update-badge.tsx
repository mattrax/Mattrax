import { Badge } from "@mattrax/ui";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { SoftwareUpdateInfo } from "@mattrax/enterprise-domain/client";
import { softwareUpdateReason } from "@mattrax/enterprise-domain/client";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
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
 * The update badge shared by the device list, the device header and the
 * overview. Windows and Android render the caller's empty state: the SOFA feed
 * only covers macOS, and a coloured "unknown" badge there would imply the
 * check applies to them.
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
