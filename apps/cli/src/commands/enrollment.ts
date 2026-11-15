import { Effect } from "effect";
import { Command } from "effect/cli";
import { formatJson, formatKeyValues, line } from "../output.ts";
import { commandContext, resolveTenantId } from "./shared.ts";

const show = Command.make(
  "show",
  {},
  Effect.fn(function* () {
    const { flags, settings, api } = yield* commandContext();
    const tenantId = yield* resolveTenantId(api, settings);
    const enrollment = yield* api.getEnrollment(tenantId);
    const link = `${settings.url}/enroll/${encodeURIComponent(enrollment.id)}`;

    if (flags.json) {
      yield* line(formatJson({ tenantId, link, enrollment }));

      return;
    }

    yield* line(
      formatKeyValues([
        { key: "Tenant", value: tenantId },
        { key: "Enrollment id", value: enrollment.id },
        { key: "Link", value: link },
        { key: "Apple", value: enrollment.enabledApple ? "enabled" : "disabled" },
        { key: "Windows", value: enrollment.enabledWindows ? "enabled" : "disabled" },
        { key: "Android", value: enrollment.enabledAndroid ? "enabled" : "disabled" },
        { key: "Android ready", value: enrollment.androidAvailable ?? false },
        { key: "Asset tag", value: enrollment.enabledAssetTag ? "enabled" : "disabled" },
        { key: "Device limit", value: enrollment.maxDevices },
        { key: "Code", value: enrollment.code ?? "(not required)" },
      ]),
    );

    if (enrollment.windowsDiscoveryUrl) {
      yield* line("");
      yield* line("Windows discovery URL (contains a signed tenant token):");
      yield* line(enrollment.windowsDiscoveryUrl);

      if (enrollment.windowsDiscoveryExpiresAt)
        yield* line(`Expires ${enrollment.windowsDiscoveryExpiresAt}`);
    }
  }),
).pipe(Command.withDescription("Show the tenant enrollment link and platform status"));

export const enrollmentCommand = Command.make("enrollment").pipe(
  Command.withDescription("Inspect enrollment settings"),
  Command.withSubcommands([show]),
);
