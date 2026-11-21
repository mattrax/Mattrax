import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Effect, Option, Schema } from "effect";

/** A handler-level failure that the CLI formats once, without a stack trace. */
export class CliFailure extends Schema.TaggedError<CliFailure>()("CliFailure", {
  message: Schema.String,
  /** Extra guidance printed under the error. */
  hint: Schema.optional(Schema.String),
  /** Override the process exit code (defaults to 1). */
  exitCode: Schema.optional(Schema.Number),
  /** The handler already rendered the failure; do not print it twice. */
  silent: Schema.optional(Schema.Boolean),
}) {}

export const DEFAULT_ORIGIN = "https://e.mattrax.app";

export const StoredSettings = Schema.Struct({
  url: Schema.String,
  token: Schema.String,
  tenant: Schema.optional(Schema.String),
});

export type StoredSettings = typeof StoredSettings.Type;

export interface SettingsFlags {
  readonly url: Option.Option<string>;
  readonly token: Option.Option<string>;
  readonly tenant: Option.Option<string>;
  readonly json: boolean;
  readonly yes: boolean;
}

export type SettingsSource = "flag" | "env" | "file" | "default";

export interface ResolvedSettings {
  readonly url: string;
  readonly token: string | undefined;
  readonly tenant: string | undefined;
  readonly configPath: string;
  readonly sources: {
    readonly url: SettingsSource;
    readonly token: SettingsSource | undefined;
    readonly tenant: SettingsSource | undefined;
  };
}

export interface ResolveSettingsOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stored: StoredSettings | undefined;
  readonly configPath: string;
}

const trimmed = (value: string | undefined): string | undefined => {
  const next = value?.trim();

  return next ? next : undefined;
};

export const configPath = (env: Readonly<Record<string, string | undefined>> = process.env) => {
  const override = trimmed(env.MATTRAX_CONFIG);

  if (override) return isAbsolute(override) ? override : resolve(override);

  const root = trimmed(env.XDG_CONFIG_HOME) ?? join(homedir(), ".config");

  return join(root, "mattrax", "config.json");
};

/**
 * Accept an origin, a full dashboard URL or a URL ending in `/api` and return
 * the base the CLI appends `/api/v1` to. Credentials in a URL are rejected so
 * a mistyped token cannot end up in shell history or process listings.
 */
export const normalizeOrigin = (raw: string): Effect.Effect<string, CliFailure> =>
  Effect.gen(function* () {
    const value = raw.trim();

    if (!value)
      return yield* Effect.fail(
        new CliFailure({ message: "The deployment URL must not be empty." }),
      );

    const withScheme = value.includes("://") ? value : `https://${value}`;

    const parsed = yield* Effect.try({
      try: () => new URL(withScheme),
      catch: () =>
        new CliFailure({
          message: `"${value}" is not a valid URL.`,
          hint: "Pass an origin such as https://e.mattrax.app.",
        }),
    });

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      return yield* Effect.fail(
        new CliFailure({
          message: `Unsupported URL scheme "${parsed.protocol}". Use http:// or https://.`,
        }),
      );

    if (parsed.username || parsed.password)
      return yield* Effect.fail(
        new CliFailure({
          message: "Deployment URLs must not contain credentials.",
          hint: "Pass the API token with --token, MATTRAX_TOKEN or mattrax auth login.",
        }),
      );

    parsed.search = "";
    parsed.hash = "";

    let pathname = parsed.pathname.replace(/\/+$/u, "");

    if (pathname === "/api/v1" || pathname === "/api") pathname = "";

    return `${parsed.origin}${pathname}`;
  });

export const redactToken = (token: string | undefined): string => {
  if (!token) return "(none)";

  const suffix = token.slice(-4);

  return token.startsWith("mtx_") ? `mtx_…${suffix}` : `…${suffix}`;
};

/**
 * Scrub tokens from server messages and unexpected exceptions. The CLI never
 * prints the raw token it was given, but upstream errors sometimes echo the
 * request they rejected.
 */
export const redactSecrets = (text: string): string =>
  text.replaceAll(/mtx_[A-Za-z0-9_-]{6,}/gu, (match) => redactToken(match));

const parseJson = (text: string, label: string): Effect.Effect<Schema.Json, CliFailure> =>
  Effect.try({
    try: () => JSON.parse(text),
    catch: () =>
      new CliFailure({
        message: `${label} is not valid JSON.`,
        hint: "Run `mattrax auth logout` to remove a broken configuration file.",
      }),
  });

/** Read the stored token and origin. A missing file is not an error. */
export const readStoredSettings = (
  path: string,
): Effect.Effect<StoredSettings | undefined, CliFailure> =>
  Effect.gen(function* () {
    if (!existsSync(path)) return undefined;

    const text = yield* Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: () =>
        new CliFailure({
          message: `Could not read ${path}.`,
          hint: "Check that the file exists and is readable by your user.",
        }),
    });

    const parsed = yield* parseJson(text, path);
    const decoded = Schema.decodeUnknownOption(StoredSettings)(parsed);

    if (Option.isNone(decoded))
      return yield* Effect.fail(
        new CliFailure({
          message: `${path} does not contain a Mattrax configuration.`,
          hint: "Expected a JSON object with `url` and `token` fields.",
        }),
      );

    return decoded.value;
  });

const pick = (
  flag: Option.Option<string>,
  envValue: string | undefined,
  fileValue: string | undefined,
  flagName: string,
): Effect.Effect<{ value: string | undefined; source: SettingsSource | undefined }, CliFailure> =>
  Effect.gen(function* () {
    if (Option.isSome(flag)) {
      const value = trimmed(flag.value);

      if (!value)
        return yield* Effect.fail(new CliFailure({ message: `--${flagName} must not be empty.` }));

      return { value, source: "flag" as const };
    }

    const fromEnv = trimmed(envValue);

    if (fromEnv) return { value: fromEnv, source: "env" as const };

    const fromFile = trimmed(fileValue);

    if (fromFile) return { value: fromFile, source: "file" as const };

    return { value: undefined, source: undefined };
  });

/**
 * Resolve the effective configuration. Precedence is flags, environment,
 * stored config, then the Cloud default. Tenant selection is optional until a
 * command needs one.
 */
export const resolveSettings = (
  flags: SettingsFlags,
  options: ResolveSettingsOptions,
): Effect.Effect<ResolvedSettings, CliFailure> =>
  Effect.gen(function* () {
    const url = yield* pick(flags.url, options.env.MATTRAX_URL, options.stored?.url, "url");

    const token = yield* pick(
      flags.token,
      options.env.MATTRAX_TOKEN,
      options.stored?.token,
      "token",
    );

    const tenant = yield* pick(
      flags.tenant,
      options.env.MATTRAX_TENANT,
      options.stored?.tenant,
      "tenant",
    );

    const origin = yield* normalizeOrigin(url.value ?? DEFAULT_ORIGIN);

    return {
      url: origin,
      token: token.value,
      tenant: tenant.value,
      configPath: options.configPath,
      sources: {
        url: url.source ?? "default",
        token: token.source,
        tenant: tenant.source,
      },
    };
  });

export const writeStoredSettings = (
  path: string,
  settings: StoredSettings,
): Effect.Effect<void, CliFailure> =>
  Effect.gen(function* () {
    const directory = dirname(path);

    yield* Effect.tryPromise({
      try: () => mkdir(directory, { recursive: true, mode: 0o700 }),
      catch: () =>
        new CliFailure({
          message: `Could not create ${directory}.`,
        }),
    });

    yield* Effect.tryPromise({
      try: () =>
        writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        }),
      catch: () =>
        new CliFailure({
          message: `Could not write ${path}.`,
        }),
    });

    // `mode` only applies when the file is created; an existing file may have
    // been left world-readable by an older tool.
    yield* Effect.tryPromise({
      try: () => chmod(path, 0o600),
      catch: () =>
        new CliFailure({
          message: `Could not set permissions on ${path}.`,
        }),
    });
  });

/** Remove the stored config. Returns false when there was nothing to delete. */
export const removeStoredSettings = (path: string): Effect.Effect<boolean, CliFailure> =>
  Effect.gen(function* () {
    if (!existsSync(path)) return false;

    yield* Effect.tryPromise({
      try: () => unlink(path),
      catch: () =>
        new CliFailure({
          message: `Could not remove ${path}.`,
          hint: "Delete the file manually if it is owned by another user.",
        }),
    });

    return true;
  });

export const requireToken = (settings: ResolvedSettings): Effect.Effect<string, CliFailure> => {
  if (settings.token) return Effect.succeed(settings.token);

  return Effect.fail(
    new CliFailure({
      message: "Not authenticated.",
      hint: "Run `mattrax auth login`, pass --token, or set MATTRAX_TOKEN.",
    }),
  );
};
