import { Badge } from "@mattrax/ui";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { OsComplianceInfo } from "@mattrax/enterprise-domain/client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@mattrax/ui";
import { osComplianceLabel, osComplianceReasonText, osComplianceTone } from "~/lib/os-compliance";

/**
 * Compliance badge shared by the device page and the OS versions fleet view.
 * Windows and Android rows can be compliant without knowing whether a newer
 * release exists; the tooltip says so rather than implying "up to date".
 */
export default function OsComplianceTag(props: {
  info?: OsComplianceInfo | null;
  class?: string;
  empty?: JSX.Element;
}) {
  const label = () => osComplianceLabel(props.info);
  const info = () => props.info;

  return (
    <Show when={label()} fallback={props.empty ?? <span class="text-muted-foreground">—</span>}>
      {(text) => (
        <Show when={info()}>
          {(value) => {
            const tone = () => osComplianceTone(value().status);

            return (
              <Tooltip>
                <TooltipTrigger
                  as="span"
                  tabindex={0}
                  class="inline-flex cursor-default"
                  aria-label={`OS compliance: ${text()}. ${osComplianceReasonText(value())}`}
                >
                  <span class={props.class}>
                    <Badge variant={tone().variant} dot={tone().dot}>{text()}</Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent class="max-w-64">
                  <p class="text-xs font-medium">
                    {value().currentVersion
                      ? `${platformLabel(value().platform)} ${value().currentVersion}`
                      : "OS compliance"}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    {osComplianceReasonText(value())}
                  </p>
                  <Show when={value().minimumVersion}>
                    {(minimum) => (
                      <p class="mt-1 text-xs">
                        Minimum: <span class="font-medium">{minimum()}</span>
                      </p>
                    )}
                  </Show>
                  <Show
                    when={value().targetVersion && value().targetVersion !== value().minimumVersion}
                  >
                    {(target) => (
                      <p class="mt-1 text-xs">
                        Target: <span class="font-medium">{target()}</span>
                      </p>
                    )}
                  </Show>
                  <Show when={value().enforcement === "enforce"}>
                    <p class="mt-1 text-xs text-muted-foreground">
                      Enforcement is configured for this platform. The OS versions page explains
                      exactly what is applied.
                    </p>
                  </Show>
                </TooltipContent>
              </Tooltip>
            );
          }}
        </Show>
      )}
    </Show>
  );
}

const platformLabel = (platform: OsComplianceInfo["platform"]) => {
  switch (platform) {
    case "macos":
      return "macOS";
    case "ios":
      return "iOS";
    case "ipados":
      return "iPadOS";
    case "windows":
      return "Windows";
    case "android":
      return "Android";
    default:
      return "OS";
  }
};
