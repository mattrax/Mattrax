import { Effect } from "effect";
import type { DeviceRow, GroupRow, PolicyRow, TenantInfo } from "@mattrax/enterprise-domain/client";
import type { MattraxApi } from "../client.ts";
import { type GlobalFlags, rootCommand } from "../global.ts";
import { CliRuntime } from "../runtime.ts";
import { CliFailure, type ResolvedSettings } from "../settings.ts";

export interface CommandContext {
  readonly flags: GlobalFlags;
  readonly settings: ResolvedSettings;
  readonly api: MattraxApi;
}

/** Resolve settings and a ready-to-use API client for a command handler. */
export const commandContext = Effect.fn(function* () {
  const flags = yield* rootCommand;
  const runtime = yield* CliRuntime;
  const settings = yield* runtime.resolveSettings(flags);
  const api = yield* runtime.api(settings);

  return { flags, settings, api } satisfies CommandContext;
});

const tenantMatches = (tenant: TenantInfo, value: string): boolean => {
  const needle = value.toLocaleLowerCase();

  return (
    tenant.id === value ||
    tenant.slug.toLocaleLowerCase() === needle ||
    tenant.name.toLocaleLowerCase() === needle
  );
};

const tenantList = (tenants: ReadonlyArray<TenantInfo>): string =>
  tenants.length === 0
    ? "(no tenants)"
    : tenants.map((tenant) => `${tenant.id}  ${tenant.slug}  ${tenant.name}`).join("\n");

/**
 * Resolve an id, slug or name to the tenant id used in API paths. With no
 * selection, a token that can reach exactly one tenant does not need
 * `--tenant`.
 */
export const resolveTenantId = (
  api: MattraxApi,
  settings: ResolvedSettings,
): Effect.Effect<string, CliFailure> =>
  Effect.gen(function* () {
    const { tenants } = yield* api.listTenants();

    if (settings.tenant) {
      const matches = tenants.filter((tenant) => tenantMatches(tenant, settings.tenant ?? ""));

      if (matches.length === 1) return matches[0].id;

      if (matches.length > 1)
        return yield* Effect.fail(
          new CliFailure({
            message: `Tenant "${settings.tenant}" is ambiguous.`,
            hint: `Use the tenant id:\n${tenantList(matches)}`,
          }),
        );

      return yield* Effect.fail(
        new CliFailure({
          message: `Tenant "${settings.tenant}" was not found.`,
          hint: `Available tenants:\n${tenantList(tenants)}`,
        }),
      );
    }

    if (tenants.length === 1) return tenants[0].id;

    if (tenants.length === 0)
      return yield* Effect.fail(
        new CliFailure({
          message: "This account does not belong to a tenant.",
          hint: "Create a tenant in the dashboard, or check that the API token belongs to the right user.",
        }),
      );

    return yield* Effect.fail(
      new CliFailure({
        message: "Select a tenant.",
        hint: `Pass --tenant <id|slug|name> or set MATTRAX_TENANT. Available tenants:\n${tenantList(tenants)}`,
      }),
    );
  });

export const requireConfirmation = (
  flags: GlobalFlags,
  action: string,
  target: string,
): Effect.Effect<void, CliFailure> => {
  if (flags.yes) return Effect.void;

  return Effect.fail(
    new CliFailure({
      message: `${action} ${target} is destructive and needs confirmation.`,
      hint: "Re-run with --yes once you have verified the target.",
    }),
  );
};

export const findGroup = (
  groups: ReadonlyArray<GroupRow>,
  reference: string,
): Effect.Effect<GroupRow, CliFailure> => {
  const needle = reference.toLocaleLowerCase();

  const matches = groups.filter(
    (group) => group.id === reference || group.name.toLocaleLowerCase() === needle,
  );

  if (matches.length === 1) return Effect.succeed(matches[0]);

  if (matches.length > 1)
    return Effect.fail(
      new CliFailure({
        message: `Group "${reference}" is ambiguous.`,
        hint: matches.map((group) => `${group.id}  ${group.name}`).join("\n"),
      }),
    );

  return Effect.fail(
    new CliFailure({
      message: `Group "${reference}" was not found.`,
      hint:
        groups.length === 0
          ? "This tenant has no groups."
          : `Known groups:\n${groups.map((group) => `${group.id}  ${group.name}`).join("\n")}`,
    }),
  );
};

export const resolveGroupId = (
  api: MattraxApi,
  tenantId: string,
  reference: string,
): Effect.Effect<string, CliFailure> =>
  api.listGroups(tenantId).pipe(
    Effect.flatMap(({ rows }) => findGroup(rows, reference)),
    Effect.map((group) => group.id),
  );

export const findPolicy = (
  policies: ReadonlyArray<PolicyRow>,
  reference: string,
): Effect.Effect<PolicyRow, CliFailure> => {
  const needle = reference.toLocaleLowerCase();

  const matches = policies.filter(
    (policy) => policy.id === reference || policy.name.toLocaleLowerCase() === needle,
  );

  if (matches.length === 1) return Effect.succeed(matches[0]);

  if (matches.length > 1)
    return Effect.fail(
      new CliFailure({
        message: `Policy "${reference}" is ambiguous.`,
        hint: matches.map((policy) => `${policy.id}  ${policy.name}`).join("\n"),
      }),
    );

  return Effect.fail(
    new CliFailure({
      message: `Policy "${reference}" was not found.`,
      hint:
        policies.length === 0
          ? "This tenant has no policies."
          : `Known policies:\n${policies.map((policy) => `${policy.id}  ${policy.name}`).join("\n")}`,
    }),
  );
};

export const resolvePolicyIds = (
  api: MattraxApi,
  tenantId: string,
  references: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, CliFailure> =>
  Effect.gen(function* () {
    const { rows } = yield* api.listPolicies(tenantId);
    const ids: string[] = [];

    for (const reference of references) {
      const policy = yield* findPolicy(rows, reference);

      if (!ids.includes(policy.id)) ids.push(policy.id);
    }

    return ids;
  });

const deviceMatches = (device: DeviceRow, reference: string): boolean => {
  const needle = reference.toLocaleLowerCase();

  return (
    device.id === reference ||
    device.serial === reference ||
    device.name.toLocaleLowerCase() === needle
  );
};

/**
 * Resolve device ids, serials or names. The CLI loads the tenant's device
 * list once rather than issuing a search per reference.
 */
export const resolveDeviceIds = (
  api: MattraxApi,
  tenantId: string,
  references: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, CliFailure> =>
  Effect.gen(function* () {
    if (references.length === 0) return [];

    const { rows } = yield* api.listDevices(tenantId);
    const ids: string[] = [];

    for (const reference of references) {
      const matches = rows.filter((device) => deviceMatches(device, reference));

      if (matches.length === 0)
        return yield* Effect.fail(
          new CliFailure({
            message: `Device "${reference}" was not found.`,
            hint: `Pass a device id, serial or exact name. Known devices: ${rows.length}.`,
          }),
        );

      if (matches.length > 1)
        return yield* Effect.fail(
          new CliFailure({
            message: `Device "${reference}" is ambiguous.`,
            hint: matches.map((device) => `${device.id}  ${device.name}`).join("\n"),
          }),
        );

      if (!ids.includes(matches[0].id)) ids.push(matches[0].id);
    }

    return ids;
  });
