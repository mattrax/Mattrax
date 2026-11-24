import { Effect, Layer, PlatformError, Predicate } from "effect";
import { Command } from "effect/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { FetchHttpClient } from "effect/http";
import { version } from "../package.json" with { type: "json" };
import { cli } from "./cli.ts";
import { errorLine, processOutputLayer } from "./output.ts";
import { processRuntimeLayer } from "./runtime.ts";
import { redactSecrets } from "./settings.ts";
import { CliSecureFileStore } from "./secureFileStore.ts";

const isEpipe = (error: PlatformError.PlatformError): boolean =>
  Predicate.hasProperty(error.reason, "cause") &&
  Predicate.hasProperty(error.reason.cause, "code") &&
  error.reason.cause.code === "EPIPE";

const nodeLayer = CliSecureFileStore.layer.pipe(Layer.provideMerge(NodeServices.layer));

const program = Command.run(cli, { version }).pipe(
  Effect.catchTag("CliFailure", (error) =>
    Effect.gen(function* () {
      if (!error.silent) yield* errorLine(redactSecrets(error.message));

      if (error.hint) yield* errorLine(redactSecrets(error.hint));

      process.exitCode = error.exitCode ?? 1;
    }),
  ),
  Effect.catchTag("PlatformError", (error) =>
    Effect.gen(function* () {
      // A downstream command such as `head` closing the pipe is normal CLI
      // behaviour, not a diagnostic worth printing to the broken stream.
      if (isEpipe(error)) return;

      yield* errorLine(`I/O error: ${error.message}`).pipe(Effect.catch(() => Effect.void));
      yield* Effect.sync(() => {
        process.exitCode = 1;
      });
    }),
  ),
  Effect.provide(
    Layer.mergeAll(
      FetchHttpClient.layer,
      nodeLayer,
      processRuntimeLayer,
      processOutputLayer.pipe(Layer.provide(nodeLayer)),
    ),
  ),
);

NodeRuntime.runMain(program);
