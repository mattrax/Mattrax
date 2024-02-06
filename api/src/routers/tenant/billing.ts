import { eq } from "drizzle-orm";
import { db, tenants } from "../../db";
import { createTRPCRouter, tenantProcedure } from "../../trpc";
import { encodeId } from "../../utils";
import { env } from "../../env";
import Stripe from "stripe";

export const billingRouter = createTRPCRouter({
  portalUrl: tenantProcedure.mutation(async ({ ctx }) => {
    const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

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

    let customerId: string;
    if (!tenant.stripeCustomerId) {
      const customer = await stripe.customers.create({
        name: tenant.name,
        email: tenant.billingEmail || undefined,
      });

      await db
        .update(tenants)
        .set({ stripeCustomerId: customer.id })
        .where(eq(tenants.id, ctx.tenantId));

      customerId = customer.id;
    } else {
      customerId = tenant.stripeCustomerId;
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${env.PROD_URL}/${encodeId(
        "tenant",
        ctx.tenantId
      )}/settings`,
    });

    return session.url;
  }),
});
