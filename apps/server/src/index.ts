import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import pkg from "../package.json" with { type: "json" };
const { version } = pkg;

const versionCommand = Command.make("version").pipe(
  Command.withHandler(() => Console.log(version)),
);

const serveCommand = Command.make("serve").pipe(
  Command.withHandler(() =>
    Effect.gen(function* () {
      yield* Effect.fail("not implemented");
    }),
  ),
);

const cli = Command.make("mattrax-server").pipe(
  Command.withSubcommands([versionCommand, serveCommand]),
);

const program = Command.run(cli, { version }).pipe(
  Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(program);
