import { Effect } from "effect";
import { Command } from "effect/cli";
import { type GlobalFlags, rootCommand } from "../global.ts";
import { line, formatJson } from "../output.ts";
import { CliRuntime } from "../runtime.ts";
import {
  CliFailure,
  configPath,
  redactToken,
  removeStoredSettings,
  requireToken,
  writeStoredSettings,
} from "../settings.ts";
import { resolveTenantId } from "./shared.ts";

const login = Command.make(
  "login",
  {},
  Effect.fn(function* () {
    const flags: GlobalFlags = yield* rootCommand;
    const runtime = yield* CliRuntime;

    const settings = yield* runtime.resolveSettings(flags);

    const token = yield* requireToken(settings);

    if (!token.startsWith("mtx_"))
      return yield* Effect.fail(
        new CliFailure({
          message: "That does not look like a Mattrax API token.",
          hint: "Create one under Account → API tokens; it starts with mtx_.",
        }),
      );

    const api = yield* runtime.api(settings);
    const me = yield* api.me();
    const tenantId = settings.tenant ? yield* resolveTenantId(api, settings) : undefined;

    yield* writeStoredSettings(settings.configPath, {
      url: settings.url,
      token,
      tenant: tenantId,
    });

    if (flags.json) {
      yield* line(
        formatJson({
          url: settings.url,
          account: { id: me.account.id, name: me.account.name, email: me.account.email },
          token: redactToken(token),
          tenantId: tenantId ?? null,
          configPath: settings.configPath,
        }),
      );

      return;
    }

    yield* line(`Logged in to ${settings.url} as ${me.account.email}.`);
    yield* line(`Token ${redactToken(token)} saved to ${settings.configPath} (mode 0600).`);

    if (tenantId) yield* line(`Tenant ${tenantId}`);
  }),
).pipe(Command.withDescription("Store an API token and deployment origin"));

const logout = Command.make(
  "logout",
  {},
  Effect.fn(function* () {
    const flags: GlobalFlags = yield* rootCommand;
    const path = configPath();
    const removed = yield* removeStoredSettings(path);

    if (flags.json) {
      yield* line(formatJson({ removed, path }));

      return;
    }

    yield* line(
      removed ? `Removed the stored credentials at ${path}.` : `No stored credentials at ${path}.`,
    );

    if (process.env.MATTRAX_TOKEN)
      yield* line("MATTRAX_TOKEN is still set in this environment and takes precedence.");
  }),
).pipe(Command.withDescription("Remove the stored token and origin"));

const status = Command.make(
  "status",
  {},
  Effect.fn(function* () {
    const flags: GlobalFlags = yield* rootCommand;
    const runtime = yield* CliRuntime;
    const settings = yield* runtime.resolveSettings(flags);
    const token = yield* requireToken(settings);
    const api = yield* runtime.api(settings);
    const me = yield* api.me();
    const tenantId = settings.tenant ? yield* resolveTenantId(api, settings) : undefined;

    if (flags.json) {
      yield* line(
        formatJson({
          authenticated: true,
          url: settings.url,
          token: redactToken(token),
          tokenSource: settings.sources.token ?? null,
          tenantId: tenantId ?? null,
          configPath: settings.configPath,
          account: { id: me.account.id, name: me.account.name, email: me.account.email },
          tenants: me.tenants.map((tenant) => ({
            id: tenant.id,
            slug: tenant.slug,
            name: tenant.name,
            role: tenant.role,
          })),
        }),
      );

      return;
    }

    yield* line(`Deployment  ${settings.url} (${settings.sources.url})`);
    yield* line(`Token       ${redactToken(token)} (${settings.sources.token ?? "unknown"})`);
    yield* line(`Account     ${me.account.name} <${me.account.email}>`);

    if (tenantId) yield* line(`Tenant      ${tenantId}`);
    yield* line(`Config      ${settings.configPath}`);

    if (me.tenants.length > 0) {
      yield* line("");
      yield* line("Tenants:");

      for (const tenant of me.tenants)
        yield* line(`  ${tenant.id}  ${tenant.slug.padEnd(24)} ${tenant.name} (${tenant.role})`);
    }
  }),
).pipe(Command.withDescription("Show the active deployment, token and account"));

export const authCommand = Command.make("auth").pipe(
  Command.withDescription("Authenticate the CLI"),
  Command.withSubcommands([login, logout, status]),
);
