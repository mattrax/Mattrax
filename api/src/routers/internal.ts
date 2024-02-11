import { count } from "drizzle-orm";
import { DemoEmail } from "@mattrax/email";
import { MySqlTable } from "drizzle-orm/mysql-core";

import { db, devices, policies, tenants, users } from "../db";
import { createTRPCRouter, superAdminProcedure } from "../trpc";
import { sendEmail } from "../emails";
import { promiseObjectAll } from "../utils";

export const dbCount = <TFrom extends MySqlTable>(table: TFrom) =>
  db
    .select({ count: count() })
    .from(table)
    .then((rows) => rows[0]!.count);

export const internalRouter = createTRPCRouter({
  stats: superAdminProcedure.query(({ ctx }) =>
    promiseObjectAll({
      tenants: dbCount(tenants),
      devices: dbCount(devices),
      users: dbCount(users),
      policies: dbCount(policies),
      // apps: dbCount(apps),
      // groups: dbCount(groups),
    })
  ),

  emailDemo: superAdminProcedure.mutation(async ({ ctx }) => {
    await sendEmail({
      to: "oscar@otbeaumont.me",
      subject: "Syncing tenant",
      component: DemoEmail({ url: "https://mattrax-forge.vercel.app" }),
    });
  }),
});
