import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";

/** TLS policy shared by application pools, migration runners and import tools. */
export type DatabaseSsl = false | { readonly rejectUnauthorized: boolean };

export type DatabaseConnection = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly ssl: DatabaseSsl;
};

export const DatabaseConnection = Schema.Struct({
  host: Schema.String.check(Schema.isMinLength(1)),
  port: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(65_535)),
  user: Schema.String,
  password: Schema.String,
  database: Schema.String.check(Schema.isMinLength(1)),
  ssl: Schema.Union([Schema.Literal(false), Schema.Struct({ rejectUnauthorized: Schema.Boolean })]),
});

export class DatabaseConfigError extends Schema.TaggedError<DatabaseConfigError>()(
  "DatabaseConfigError",
  { cause: Schema.Unknown },
) {}

export class DatabaseConfig extends Context.Service<DatabaseConfig, DatabaseConnection>()(
  "@mattrax/cloud-services/DatabaseConfig",
) {
  static readonly layer = Layer.effect(
    DatabaseConfig,
    Config.String("DATABASE_URL").pipe(
      Effect.flatMap((url) =>
        Effect.try({
          try: () => databaseConfigFromUrl(url),
          catch: (cause) => new DatabaseConfigError({ cause }),
        }),
      ),
    ),
  );
}

const decodeComponent = (value: string, label: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`DATABASE_URL has an invalid ${label}`);
  }
};

const sslFromParameters = (parameters: URLSearchParams): DatabaseSsl => {
  const modes = [...parameters.getAll("ssl-mode"), ...parameters.getAll("sslmode")].map((mode) =>
    mode.trim().toUpperCase(),
  );
  const uniqueModes = [...new Set(modes)];

  if (uniqueModes.length > 1)
    throw new Error("DATABASE_URL has conflicting ssl-mode and sslmode values");

  const mode = uniqueModes[0] ?? "";
  const sslValues = parameters.getAll("ssl").map((value) => value.trim().toLowerCase());

  if (sslValues.some((value) => value !== "true" && value !== "false"))
    throw new Error("DATABASE_URL ssl must be true or false");

  if (new Set(sslValues).size > 1) throw new Error("DATABASE_URL has conflicting ssl values");

  const ssl = sslValues[0];

  if (modes.length > 0 && !["DISABLED", "REQUIRED", "VERIFY_CA", "VERIFY_IDENTITY"].includes(mode))
    throw new Error(`DATABASE_URL has an unsupported TLS mode: ${mode}`);

  const modePolicy =
    mode === "DISABLED"
      ? "disabled"
      : mode === "REQUIRED"
        ? "required"
        : mode === "VERIFY_CA" || mode === "VERIFY_IDENTITY"
          ? "verify"
          : undefined;
  const sslPolicy = ssl === "false" ? "disabled" : ssl === "true" ? "required" : undefined;

  if (modePolicy !== undefined && sslPolicy !== undefined && modePolicy !== sslPolicy)
    throw new Error("DATABASE_URL has conflicting TLS policy parameters");

  const policy = modePolicy ?? sslPolicy;

  if (policy === "disabled") return false;
  if (policy === "required") return { rejectUnauthorized: false };
  if (policy === "verify") return { rejectUnauthorized: true };

  return false;
};

/** Decode and validate a MySQL URL without opening a connection. */
export const databaseConfigFromUrl = (databaseUrl: string): DatabaseConnection => {
  const url = new URL(databaseUrl.trim());

  if (url.protocol !== "mysql:") throw new Error("DATABASE_URL must use the mysql: protocol");
  if (!url.hostname) throw new Error("DATABASE_URL must include a host");
  if (url.hash) throw new Error("DATABASE_URL must not include a fragment");

  const database = decodeComponent(url.pathname.replace(/^\//, ""), "database name");

  if (!database || database.includes("/"))
    throw new Error("DATABASE_URL must include exactly one database name");

  const port = url.port === "" ? 3306 : Number(url.port);

  return Schema.decodeUnknownSync(DatabaseConnection)({
    host: url.hostname,
    port,
    user: decodeComponent(url.username, "username"),
    password: decodeComponent(url.password, "password"),
    database,
    ssl: sslFromParameters(url.searchParams),
  });
};

/** Decode the discrete DATABASE_* fallback used by local deployments. */
export const databaseConfigFromFields = (source: {
  readonly host: string;
  readonly port?: string | number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly ssl?: DatabaseSsl;
}): DatabaseConnection =>
  Schema.decodeUnknownSync(DatabaseConnection)({
    host: source.host.trim(),
    port: source.port === undefined || source.port === "" ? 3306 : Number(source.port),
    user: source.user,
    password: source.password,
    database: source.database,
    ssl: source.ssl ?? false,
  });

/** Options accepted by mysql2 for both pools and one-off migration connections. */
export const mysqlConnectionOptions = (config: DatabaseConnection) => ({
  host: config.host,
  port: config.port,
  user: config.user,
  password: config.password,
  database: config.database,
  ...(config.ssl ? { ssl: config.ssl } : {}),
});

/** Options accepted by @effect/sql-mysql2. */
export const mysqlClientOptions = (config: DatabaseConnection) => ({
  host: config.host,
  port: config.port,
  username: config.user,
  password: Redacted.make(config.password),
  database: config.database,
  poolConfig: {
    disableEval: true,
    timezone: "Z",
    ...(config.ssl ? { ssl: config.ssl } : {}),
  },
  disablePreparedStatements: true,
});

export const databaseConfigLayerFromUrl = (databaseUrl: string) =>
  Layer.succeed(DatabaseConfig, databaseConfigFromUrl(databaseUrl));
