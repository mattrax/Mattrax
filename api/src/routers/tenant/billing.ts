import { eq } from "drizzle-orm";
import { db, tenants } from "../../db";
import { createTRPCRouter, tenantProcedure } from "../../trpc";
import { encodeId } from "../../utils";
import { stripe } from "../../stripe";
import { env } from "../../env";

export const billingRouter = createTRPCRouter({
  portalUrl: tenantProcedure.mutation(async ({ ctx }) => {
    console.log("A");
    const tenant = (
      await db
        .select({
          name: tenants.name,
          billingEmail: tenants.billingEmail,
          stripeCustomerId: tenants.stripeCustomerId,
        })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
    )?.[0];
    if (!tenant) throw new Error("Tenant not found!"); // TODO: Proper error code which the frontend knows how to handle

    console.log("B");

    let customerId: string;
    if (!tenant.stripeCustomerId) {
      console.log("C");
      const customer = await stripe.customers.create({
        name: tenant.name,
        email: tenant.billingEmail || undefined,
      });
      console.log("D");

      await db
        .update(tenants)
        .set({ stripeCustomerId: customer.id })
        .where(eq(tenants.id, ctx.tenantId));

      console.log("E");

      customerId = customer.id;
    } else {
      customerId = tenant.stripeCustomerId;
    }

    console.log("F", customerId);

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${env.PROD_URL}/${encodeId(
        "tenant",
        ctx.tenantId
      )}/settings`,
    });

    console.log("G");

    return session.url;
  }),
});
