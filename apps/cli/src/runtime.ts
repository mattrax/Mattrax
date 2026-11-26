import { Context, Effect, FileSystem, Layer, Path } from "effect";
import type { HttpClient } from "effect/http";
import { MattraxApiLive } from "./client.ts";
import type { MattraxApi } from "./client.ts";
import type { CliFailure } from "./settings.ts";
import {
  configPath,
  environmentValue,
  readStoredSettings,
  requireToken,
  resolveSettings,
} from "./settings.ts";
import type { ResolvedSettings, SettingsFlags } from "./settings.ts";

export interface CliRuntimeContract {
  readonly resolveSettings: (
    flags: SettingsFlags,
  ) => Effect.Effect<ResolvedSettings, CliFailure, FileSystem.FileSystem | Path.Path>;
  readonly api: (
    settings: ResolvedSettings,
  ) => Effect.Effect<MattraxApi, CliFailure, HttpClient.HttpClient>;
}

/**
 * Dependency boundary for commands: configuration resolution and API
 * construction. Tests replace this service with fixed settings and a fake API.
 */
export class CliRuntime extends Context.Service<CliRuntime, CliRuntimeContract>()(
  "@mattrax/cli/CliRuntime",
) {}

export const processRuntimeLayer = Layer.succeed(
  CliRuntime,
  CliRuntime.of({
    resolveSettings: (flags) =>
      Effect.gen(function* () {
        const path = yield* configPath;
        const stored = yield* readStoredSettings(path);
        const [url, token, tenant] = yield* Effect.all([
          environmentValue("MATTRAX_URL"),
          environmentValue("MATTRAX_TOKEN"),
          environmentValue("MATTRAX_TENANT"),
        ]);

        return yield* resolveSettings(flags, {
          env: { MATTRAX_URL: url, MATTRAX_TOKEN: token, MATTRAX_TENANT: tenant },
          stored,
          configPath: path,
        });
      }),
    api: (settings) =>
      requireToken(settings).pipe(
        Effect.flatMap((token) =>
          MattraxApiLive.pipe(Effect.provide(MattraxApiLive.layer(settings.url, token))),
        ),
      ),
  }),
);
