import { eq } from "drizzle-orm";
import { db, tenants } from "~/db";
import { createTRPCRouter, tenantProcedure } from "../../helpers";
import { env } from "~/env";
import { stripe } from "~/api/stripe";
import type Stripe from "stripe";

export const billingRouter = createTRPCRouter({
  portalUrl: tenantProcedure.mutation(async ({ ctx }) => {
    const [tenant] = await db
      .select({
        name: tenants.name,
        billingEmail: tenants.billingEmail,
        stripeCustomerId: tenants.stripeCustomerId,
      })
      .from(tenants)
      .where(eq(tenants.pk, ctx.tenant.pk));
    if (!tenant) throw new Error("Tenant not found!"); // TODO: Proper error code which the frontend knows how to handle

    let customerId: string;
    if (!tenant.stripeCustomerId) {
      try {
        const customer = await stripe.customers.create({
          name: tenant.name,
          email: tenant.billingEmail || undefined,
        });

        await db
          .update(tenants)
          .set({ stripeCustomerId: customer.id })
          .where(eq(tenants.pk, ctx.tenant.pk));

        customerId = customer.id;
      } catch (err) {
        console.error("Error creating customer", err);
        throw new Error("Error creating customer");
      }
    } else {
      customerId = tenant.stripeCustomerId;
    }

    // TODO: When using the official Stripe SDK, this endpoint causes the entire Edge Function to hang and i'm at a loss to why.
    // TODO: This will do for now but we should try and fix it.

    const body = new URLSearchParams({
      customer: customerId,
      return_url: `${env.PROD_URL}/${ctx.tenant.pk}/settings`,
    });

    const resp = await fetch(
      "https://api.stripe.com/v1/billing_portal/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      }
    );
    if (!resp.ok) {
      const body = await resp.text();
      console.error("Error creating billing portal session", resp.status, body);
      throw new Error(
        `Error creating billing portal session: '${resp.status}' '${body}'`
      );
    }
    const session: Stripe.Response<Stripe.BillingPortal.Session> =
      await resp.json();

    return session.url;
  }),
});
