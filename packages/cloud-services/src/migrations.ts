import { Duration, Effect, Predicate, Schedule, Schema } from "effect";

export interface Migration {
  readonly name: string;
  readonly statements: ReadonlyArray<string>;
  readonly hash: string;
  readonly createdAt: number;
}

/** Structural subset of mysql2's connection used by the shared runner. */
export interface MigrationConnection {
  query<T extends unknown[] = unknown[]>(
    sql: string,
    values?: Array<unknown>,
  ): Promise<[T, unknown]>;
  end(): Promise<void>;
}

export class MigrationError extends Schema.TaggedError<MigrationError>()("MigrationError", {
  operation: Schema.String,
  cause: Schema.Unknown,
}) {}

const transientCodes = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "ER_CON_COUNT_ERROR",
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_SEQUENCE_TIMEOUT",
]);

/** Retry availability failures, never authentication, syntax or policy errors. */
export const isTransientDatabaseError = (cause: unknown): boolean => {
  if (!Predicate.isError(cause) || !("code" in cause)) return false;

  const code = cause.code;

  return (typeof code === "string" || typeof code === "number") && transientCodes.has(String(code));
};

export interface RunMigrationsOptions {
  readonly migrations: ReadonlyArray<Migration>;
  readonly lockName: string;
  readonly label: string;
  readonly connect: Effect.Effect<MigrationConnection, unknown>;
  readonly log?: (message: string) => void;
  readonly retrySchedule?: Schedule.Schedule<unknown, unknown>;
  readonly timeout?: Duration.Input;
}

const query = <T extends unknown[]>(
  connection: MigrationConnection,
  operation: string,
  sql: string,
  values?: Array<unknown>,
): Effect.Effect<[T, unknown], MigrationError> =>
  Effect.tryPromise({
    try: () => connection.query<T>(sql, values),
    catch: (cause) => new MigrationError({ operation, cause }),
  });

/**
 * Apply Drizzle bookkeeping migrations under a connection-scoped advisory
 * lock. Connection retries are bounded and transient-only; the whole run has
 * an overall deadline so a lock wait cannot hang container startup forever.
 */
export const runMigrations = ({
  migrations,
  lockName,
  label,
  connect,
  log = console.log,
  retrySchedule = Schedule.exponential("250 millis").pipe(Schedule.upTo({ times: 9 })),
  timeout = "2 minutes",
}: RunMigrationsOptions): Effect.Effect<void, MigrationError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* Effect.acquireRelease(
        connect.pipe(
          Effect.retry({
            schedule: retrySchedule,
            while: isTransientDatabaseError,
          }),
          Effect.mapError(
            (cause) => new MigrationError({ operation: "connect to database", cause }),
          ),
        ),
        (connection) =>
          Effect.tryPromise(() => connection.end()).pipe(
            Effect.mapError(
              (cause) => new MigrationError({ operation: "close migration connection", cause }),
            ),
            Effect.orDie,
          ),
        { interruptible: true },
      );

      const [lockRows] = yield* query<Array<{ acquired: number | string }>>(
        connection,
        "acquire migration lock",
        "SELECT GET_LOCK(?, 60) AS acquired",
        [lockName],
      );

      if (Number(lockRows[0]?.acquired) !== 1)
        return yield* Effect.fail(
          new MigrationError({
            operation: "acquire migration lock",
            cause: new Error(`could not acquire the ${label} migration lock`),
          }),
        );

      const releaseLock = query(connection, "release migration lock", "SELECT RELEASE_LOCK(?)", [
        lockName,
      ]).pipe(
        Effect.asVoid,
        Effect.catch((error) =>
          Effect.logWarning("Could not release the database migration lock", {
            operation: error.operation,
            error,
          }),
        ),
      );

      yield* Effect.ensuring(
        Effect.gen(function* () {
          yield* query(
            connection,
            "create migrations table",
            `
              CREATE TABLE IF NOT EXISTS \`__drizzle_migrations\` (
                id SERIAL PRIMARY KEY,
                hash TEXT NOT NULL,
                created_at BIGINT,
                name TEXT,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
              )
            `,
          );

          const [rows] = yield* query<Array<{ hash: string }>>(
            connection,
            "read applied migrations",
            "SELECT hash FROM `__drizzle_migrations`",
          );
          const applied = new Set(rows.map((row) => String(row.hash)));
          const pending = migrations.filter((migration) => !applied.has(migration.hash));

          if (pending.length === 0) {
            log(`${label}: database schema is up to date`);

            return;
          }

          for (const migration of pending) {
            log(`${label}: applying migration ${migration.name}`);

            // MySQL commits DDL immediately. Stop on the first failure rather
            // than replaying a partially applied migration on the next boot.
            for (const statement of migration.statements)
              yield* query(connection, `apply migration ${migration.name}`, statement);

            yield* query(
              connection,
              `record migration ${migration.name}`,
              "INSERT INTO `__drizzle_migrations` (`hash`, `created_at`, `name`) VALUES (?, ?, ?)",
              [migration.hash, migration.createdAt, migration.name],
            );
          }
        }),
        releaseLock,
      );
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () =>
        Effect.fail(
          new MigrationError({
            operation: "run migrations",
            cause: new Error(`migrations exceeded the ${label} deadline`),
          }),
        ),
    }),
  );
