import { Command, Flag } from "effect/cli";
import type { Option } from "effect";

/**
 * Flags shared by every command and subcommand. Effect CLI accepts shared
 * flags before or after the subcommand name, so both `mattrax --json devices
 * list` and `mattrax devices list --json` work.
 */
export const globalFlags = {
  url: Flag.String("url").pipe(
    Flag.withDescription("Deployment origin (defaults to https://e.mattrax.app)"),
    Flag.optional,
  ),
  token: Flag.String("token").pipe(
    Flag.withDescription("API token; prefer MATTRAX_TOKEN or `mattrax auth login`"),
    Flag.optional,
  ),
  tenant: Flag.String("tenant").pipe(
    Flag.withDescription("Tenant id, slug or name (env: MATTRAX_TENANT)"),
    Flag.optional,
  ),
  json: Flag.Boolean("json").pipe(
    Flag.withDescription("Emit stable JSON for scripts"),
    Flag.withDefault(false),
  ),
  yes: Flag.Boolean("yes").pipe(
    Flag.withAlias("y"),
    Flag.withDescription("Confirm a destructive action without prompting"),
    Flag.withDefault(false),
  ),
} as const;

export type GlobalFlags = {
  readonly url: Option.Option<string>;
  readonly token: Option.Option<string>;
  readonly tenant: Option.Option<string>;
  readonly json: boolean;
  readonly yes: boolean;
};

/** Parent command subcommands yield to read the shared configuration. */
export const rootCommand = Command.make("mattrax").pipe(Command.withSharedFlags(globalFlags));
