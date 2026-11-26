import "reflect-metadata";
import "./nodeEnvironment.js";
import path from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { createApiRuntime } from "@mattrax/cloud/runtime";
import { databaseConfigFromFields, databaseConfigFromUrl } from "@mattrax/cloud-services";
import { nodeCryptoLayer } from "./cryptoNode.js";
import { fileSystemR2 } from "./r2Node.js";
import { drainBackgroundTasks, idleBackgroundTasks } from "./cloudflareWorkersNode.js";

/**
 * Node entry point for the API.
 *
 * The Cloudflare entry takes its configuration from bindings. Here the same
 * shape is assembled from the process environment: Hyperdrive becomes a MySQL
 * connection, the R2 binding becomes a directory, and every plain binding is
 * read from `process.env`. The runtime itself is the shared `app.ts`, so the
 * routes and scheduled work are identical on both hosts.
 */

const runtime = createApiRuntime(nodeCryptoLayer, { cacheHandler: true });

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();

  if (!value) throw new Error(`${name} is required`);

  return value;
};

const parseDatabase = () => {
  const url = process.env.DATABASE_URL?.trim();

  if (url) return databaseConfigFromUrl(url);

  return {
    ...databaseConfigFromFields({
      host: requireEnv("DATABASE_HOST"),
      port: process.env.DATABASE_PORT,
      user: requireEnv("DATABASE_USER"),
      password: requireEnv("DATABASE_PASSWORD"),
      database: requireEnv("DATABASE_NAME"),
    }),
  };
};

const dataDirectory = process.env.DATA_DIR?.trim() || "/data";
const database = parseDatabase();
const storage = await Effect.runPromise(
  fileSystemR2({ root: path.join(dataDirectory, "storage") }).pipe(
    Effect.provide(NodeFileSystem.layer),
  ),
);

const bindings = {
  ...process.env,
  ORIGIN: requireEnv("ORIGIN"),
  AUTH_SECRET: requireEnv("AUTH_SECRET"),
  TRUSTED_ORIGINS: process.env.TRUSTED_ORIGINS,
  HYPERDRIVE: {
    host: database.host,
    port: database.port,
    user: database.user,
    password: database.password,
    database: database.database,
    ...(database.ssl ? { ssl: database.ssl } : {}),
  },
  STORAGE: storage,
  CF_VERSION_METADATA: { id: process.env.CF_VERSION_METADATA_ID ?? "selfhost" },
};

// SAFETY: every field the shared runtime reads is present above: process.env
// supplies the plain-text bindings and the two platform bindings are the Node
// adapters built here.
const env = bindings as Env;

/** The subset of Workers' `ExecutionContext` the runtime uses. */
export type RuntimeContext = {
  waitUntil: (promise: Promise<unknown>) => void;
  passThroughOnException?: () => void;
};

// SAFETY: the runtime only calls `waitUntil` and `passThroughOnException`, the
// two members of Workers' ExecutionContext defined above.
export const fetch = (request: Request, context: RuntimeContext): Promise<Response> =>
  runtime.fetch(request, env, context as ExecutionContext);

// SAFETY: same ExecutionContext subset as `fetch`.
export const scheduled = (
  controller: ScheduledController,
  context: RuntimeContext,
): Promise<void> => runtime.scheduled(controller, env, context as ExecutionContext);

export default { fetch, scheduled };

export const backgroundTasks = { idle: idleBackgroundTasks, drain: drainBackgroundTasks };
