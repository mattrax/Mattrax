import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { stripe } from "~/api/stripe";
import { db, organisations } from "~/db";
import { env } from "~/env";
import { createTRPCRouter, orgProcedure } from "../../helpers";
import { TRPCError } from "@trpc/server";

export const billingRouter = createTRPCRouter({
	portalUrl: orgProcedure.mutation(async ({ ctx }) => {
		const [org] = await db
			.select({
				name: organisations.name,
				billingEmail: organisations.billingEmail,
				stripeCustomerId: organisations.stripeCustomerId,
			})
			.from(organisations)
			.where(eq(organisations.pk, ctx.org.pk));
		if (!org)
			throw new TRPCError({ code: "NOT_FOUND", message: "organisation" }); // TODO: Proper error code which the frontend knows how to handle

		let customerId: string;
		if (!org.stripeCustomerId) {
			try {
				const customer = await stripe.customers.create({
					name: org.name,
					email: org.billingEmail || undefined,
				});

				await db
					.update(organisations)
					.set({ stripeCustomerId: customer.id })
					.where(eq(organisations.pk, ctx.org.pk));

				customerId = customer.id;
			} catch (err) {
				console.error("Error creating customer", err);
				throw new Error("Error creating customer");
			}
		} else {
			customerId = org.stripeCustomerId;
		}

		// TODO: When using the official Stripe SDK, this endpoint causes the entire Edge Function to hang and i'm at a loss to why.
		// TODO: This will do for now but we should try and fix it.

		const body = new URLSearchParams({
			customer: customerId,
			return_url: `${env.PROD_URL}/o/${ctx.org.slug}/settings`,
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
			},
		);
		if (!resp.ok) {
			const body = await resp.text();
			console.error("Error creating billing portal session", resp.status, body);
			throw new Error(
				`Error creating billing portal session: '${resp.status}' '${body}'`,
			);
		}
		const session: Stripe.Response<Stripe.BillingPortal.Session> =
			await resp.json();

		return session.url;
	}),
});
