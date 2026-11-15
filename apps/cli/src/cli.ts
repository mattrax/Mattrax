import { Command } from "effect/cli";
import { authCommand } from "./commands/auth.ts";
import { devicesCommand } from "./commands/devices.ts";
import { enrollmentCommand } from "./commands/enrollment.ts";
import { groupsCommand } from "./commands/groups.ts";
import { policiesCommand } from "./commands/policies.ts";
import { versionCommand } from "./commands/version.ts";
import { rootCommand } from "./global.ts";

export const cli = rootCommand.pipe(
  Command.withDescription(
    "Manage Mattrax Cloud or a self-hosted Mattrax deployment from the terminal.",
  ),
  Command.withSubcommands([
    authCommand,
    devicesCommand,
    policiesCommand,
    groupsCommand,
    enrollmentCommand,
    versionCommand,
  ]),
  Command.withExamples([
    {
      command: "mattrax auth login --url https://e.mattrax.app",
      description: "Store a token for the Cloud deployment",
    },
    {
      command: "mattrax devices list --status enrolled --health attention",
      description: "Find enrolled devices that need attention",
    },
    {
      command: "mattrax devices action <id> sync --json",
      description: "Queue a sync and emit JSON",
    },
    {
      command: "mattrax policies export --include-ids -o policies.yaml",
      description: "Export every policy as a portable document",
    },
    {
      command: "mattrax policies apply --dry-run policies.yaml",
      description: "Preview an apply without writing",
    },
    {
      command: "mattrax groups apply groups.yaml --dry-run",
      description: "Preview group and membership changes",
    },
  ]),
);
