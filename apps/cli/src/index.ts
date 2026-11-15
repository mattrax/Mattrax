import { Effect, Layer } from "effect";
import { Command } from "effect/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { version } from "../package.json" with { type: "json" };
import { cli } from "./cli.ts";
import { errorLine, processOutputLayer } from "./output.ts";
import { processRuntimeLayer } from "./runtime.ts";
import { redactSecrets } from "./settings.ts";

const program = Command.run(cli, { version }).pipe(
  Effect.catchTag("CliFailure", (error) =>
    Effect.gen(function* () {
      if (!error.silent) yield* errorLine(redactSecrets(error.message));

      if (error.hint) yield* errorLine(redactSecrets(error.hint));

      process.exitCode = error.exitCode ?? 1;
    }),
  ),
  Effect.provide(Layer.mergeAll(NodeServices.layer, processRuntimeLayer, processOutputLayer)),
);

NodeRuntime.runMain(program);
