import { Effect } from "effect";
import { Command } from "effect/cli";
import { version } from "../../package.json" with { type: "json" };
import { rootCommand } from "../global.ts";
import { formatJson, line } from "../output.ts";

const versionCommand = Command.make(
  "version",
  {},
  Effect.fn(function* () {
    const flags = yield* rootCommand;

    yield* line(flags.json ? formatJson({ version }) : `mattrax ${version}`);
  }),
).pipe(Command.withDescription("Print the CLI version"));

export { versionCommand };
