import { Context, Effect, Layer } from "effect";
import { type MattraxApi, createHttpApi } from "./client.ts";
import {
  type ResolvedSettings,
  type SettingsFlags,
  CliFailure,
  configPath,
  readStoredSettings,
  requireToken,
  resolveSettings,
} from "./settings.ts";

export interface CliRuntimeContract {
  readonly resolveSettings: (flags: SettingsFlags) => Effect.Effect<ResolvedSettings, CliFailure>;
  readonly api: (settings: ResolvedSettings) => Effect.Effect<MattraxApi, CliFailure>;
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
        const path = configPath();
        const stored = yield* readStoredSettings(path);

        return yield* resolveSettings(flags, {
          env: process.env,
          stored,
          configPath: path,
        });
      }),
    api: (settings) =>
      requireToken(settings).pipe(Effect.map((token) => createHttpApi(settings.url, token))),
  }),
);
