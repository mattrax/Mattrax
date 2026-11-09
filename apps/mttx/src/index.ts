import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { Command } from "effect/cli";
import pkg from "../package.json" with { type: "json" };
import { serveCommand } from "./commands/serve.ts";
import { updateCommand } from "./commands/update.ts";
import { versionCommand } from "./commands/version.ts";

const { version } = pkg;

const cli = Command.make("mttx").pipe(
  Command.withSubcommands([versionCommand, serveCommand, updateCommand]),
);

const program = Command.run(cli, { version }).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
