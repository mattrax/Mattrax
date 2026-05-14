import { Console } from "effect";
import { Command } from "effect/unstable/cli";

export const updateCommand = Command.make("update").pipe(
  Command.withHandler(() => Console.log("Update command is not implemented yet.")),
);
