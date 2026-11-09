import { Console } from "effect";
import { Command } from "effect/cli";
import pkg from "../../package.json" with { type: "json" };

export const versionCommand = Command.make("version").pipe(
  Command.withHandler(() => Console.log(pkg.version)),
);
