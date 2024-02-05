import { count } from "drizzle-orm";
import { db, devices, policies, tenants, users } from "../db";
import { createTRPCRouter, superAdminProcedure } from "../trpc";
import { sendEmail } from "../emails";
// import { DemoEmail } from "@mattrax/email";

export const internalRouter = createTRPCRouter({
  stats: superAdminProcedure.query(async ({ ctx }) =>
    Object.fromEntries(
      await Promise.all([
        await db
          .select({ count: count() })
          .from(tenants)
          .then((rows) => ["tenants", rows?.[0]?.count || 0] as const),
        await db
          .select({ count: count() })
          .from(devices)
          .then((rows) => ["devices", rows?.[0]?.count || 0] as const),
        await db
          .select({ count: count() })
          .from(users)
          .then((rows) => ["users", rows?.[0]?.count || 0] as const),
        await db
          .select({ count: count() })
          .from(policies)
          .then((rows) => ["policies", rows?.[0]?.count || 0] as const),
        // TODO: Applications
        // await db
        //   .select({ count: count() })
        //   .from(applications)
        //   .then((rows) => ["tenants", rows?.[0]?.count || 0] as const),
        // TODO: Groups
      ])
    )
  ),

  emailDemo: superAdminProcedure.mutation(async ({ ctx }) => {
    await sendEmail({
      to: "oscar@otbeaumont.me",
      subject: "Syncing tenant",
      component: "", // DemoEmail({ url: "https://mattrax-forge.vercel.app" }),
    });
  }),
});
