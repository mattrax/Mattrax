import { Effect, Layer } from "effect";
import { MysqlClient } from "@effect/sql-mysql2";
import {
  makeEntitlementSync,
  reconcileEntitlements,
  ServicesDbService,
} from "@mattrax/enterprise-billing";
import { databaseConfigFromUrl, mysqlClientOptions } from "@mattrax/cloud-services";

/**
 * Post-drain entitlement reconciliation for the revision rollout.
 *
 * Run after both migrations are applied, new services are deployed, all old
 * services instances/in-flight pushes have drained, and the revision-aware
 * Cloud receiver is live:
 *
 *   DATABASE_URL=… MATTRAX_CLOUD_URL=… SERVICES_TOKEN=… \
 *     pnpm --filter @mattrax/services entitlements:reconcile
 */

const databaseUrl = process.env.DATABASE_URL?.trim();
const cloudUrl = process.env.MATTRAX_CLOUD_URL?.trim();
const servicesToken = process.env.SERVICES_TOKEN?.trim();

if (!databaseUrl || !cloudUrl || !servicesToken) {
  console.error("DATABASE_URL, MATTRAX_CLOUD_URL and SERVICES_TOKEN are required");
  process.exit(1);
}

const database = MysqlClient.layer(mysqlClientOptions(databaseConfigFromUrl(databaseUrl)));
const servicesDb = ServicesDbService.layer.pipe(Layer.provide(database));
const sync = makeEntitlementSync({ url: cloudUrl, token: servicesToken, fetch: globalThis.fetch });

const program = Effect.gen(function* () {
  const db = yield* ServicesDbService;
  const result = yield* reconcileEntitlements(db, sync);

  console.log(
    `Reconciled ${result.tenants} tenant entitlements; promoted ${result.promoted} revision-0 rows.`,
  );
});

await Effect.runPromise(program.pipe(Effect.provide(servicesDb)));
