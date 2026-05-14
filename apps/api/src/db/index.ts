import { drizzle } from "drizzle-orm/node-postgres";
import { Context, Effect, Layer } from "effect";
import type { EnterpriseDb } from "@mattrax/enterprise-backend/schema";
import * as schema from "./schema";

type PromiseLikeQuery<A = unknown> = PromiseLike<A>;
type EffectQuery<A = unknown> = Effect.Effect<A, unknown>;
type ScepCa = { readonly id: number; readonly certPem: string; readonly privateKeyJwk: unknown; readonly createdAt: Date };
type QueryNamespace = EnterpriseDb["query"] & { readonly scepCa: { readonly findFirst: (query?: unknown) => EffectQuery<ScepCa | undefined> } };

export type DatabaseClient = EnterpriseDb & Omit<ReturnType<typeof drizzle<typeof schema.dbSchema>>, "query" | "select" | "insert" | "update" | "delete"> & {
  readonly query: QueryNamespace;
};

const runQuery = <A>(query: PromiseLikeQuery<A>): EffectQuery<A> => Effect.tryPromise(() => Promise.resolve(query));

const isPromiseLike = (value: unknown): value is PromiseLikeQuery =>
  typeof value === "object" && value !== null && typeof (value as { readonly then?: unknown }).then === "function";

const wrapBuilder = <A extends object>(builder: A): A => new Proxy(builder, {
  get(target, property, receiver) {
    if (property === Symbol.iterator) return runQuery(target as PromiseLikeQuery)[Symbol.iterator].bind(runQuery(target as PromiseLikeQuery));
    if (property === "pipe") return runQuery(target as PromiseLikeQuery).pipe.bind(runQuery(target as PromiseLikeQuery));
    if (property === "toJSON") return runQuery(target as PromiseLikeQuery).toJSON.bind(runQuery(target as PromiseLikeQuery));

    const value = Reflect.get(target, property, receiver) as unknown;
    if (typeof value !== "function") return value;

    return (...args: Array<unknown>) => {
      const result = (value as (...args: Array<unknown>) => unknown).apply(target, args);
      return typeof result === "object" && result !== null ? wrapBuilder(result) : result;
    };
  },
});

const wrapQueryNamespace = (query: unknown): QueryNamespace => new Proxy({}, {
  get(_target, tableName) {
    const tableQuery = (query as Record<PropertyKey, unknown>)[tableName];
    return new Proxy({}, {
      get(_tableTarget, methodName) {
        const method = (tableQuery as Record<PropertyKey, unknown> | undefined)?.[methodName];
        if (typeof method !== "function") return method;
        return (...args: Array<unknown>) => {
          const result = (method as (...args: Array<unknown>) => unknown).apply(tableQuery, args);
          return isPromiseLike(result) ? runQuery(result) : result;
        };
      },
    });
  },
}) as QueryNamespace;

const wrapDatabase = (db: ReturnType<typeof drizzle<typeof schema.dbSchema>>): DatabaseClient => new Proxy(db, {
  get(target, property, receiver) {
    if (property === "query") return wrapQueryNamespace(target.query);

    const value = Reflect.get(target, property, receiver) as unknown;
    if ((property === "select" || property === "insert" || property === "update" || property === "delete") && typeof value === "function") {
      return (...args: Array<unknown>) => wrapBuilder((value as (...args: Array<unknown>) => object).apply(target, args));
    }
    return value;
  },
}) as unknown as DatabaseClient;

export class Database extends Context.Service<Database, DatabaseClient>()("Database") {}

export const createEffectDbLayer = (hyperdrive: Hyperdrive) => {
  return Layer.succeed(Database, wrapDatabase(drizzle(hyperdrive.connectionString, { schema: schema.dbSchema })));
};
