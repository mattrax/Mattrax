import { Schema } from "effect";
import { databaseConfigFromUrl } from "@mattrax/cloud-services";

const nonEmptyString = Schema.String.check(Schema.isMinLength(1));
const port = Schema.NumberFromString.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(65_535),
);
const origin = Schema.String.check(
  Schema.makeFilter<string>((value) => {
    try {
      const url = new URL(value);

      return url.protocol === "http:" || url.protocol === "https:"
        ? true
        : "an http: or https: URL";
    } catch {
      return "a valid URL";
    }
  }),
);

const RuntimeConfig = Schema.Struct({
  host: nonEmptyString,
  port,
  origin,
  authSecret: Schema.String.check(Schema.isMinLength(32)),
  databaseUrl: nonEmptyString,
  dataDirectory: nonEmptyString,
  skipMigrations: Schema.Boolean,
});

export type RuntimeConfig = Schema.Schema.Type<typeof RuntimeConfig>;

/** Validate every host setting before importing the API or running migrations. */
export const runtimeConfigFromEnv = (source: NodeJS.ProcessEnv): RuntimeConfig => {
  const skipMigrations = /^(1|true|yes|on)$/i.test(source.SKIP_MIGRATIONS?.trim() ?? "");
  const config = Schema.decodeUnknownSync(RuntimeConfig)({
    host: source.HOST?.trim() || "0.0.0.0",
    port: source.PORT?.trim() || "8080",
    origin: source.ORIGIN?.trim(),
    authSecret: source.AUTH_SECRET?.trim(),
    databaseUrl: source.DATABASE_URL?.trim(),
    dataDirectory: source.DATA_DIR?.trim() || "/data",
    skipMigrations,
  });

  // Database URL syntax and TLS mode are host configuration too. Fail before
  // the API bundle is imported or a migration socket is opened.
  databaseConfigFromUrl(config.databaseUrl);

  return config;
};
