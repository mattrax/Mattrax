import Stripe from "stripe";
import { getEnv } from "~/env";

const httpClient = Stripe.createFetchHttpClient();

export const stripe = new Stripe(getEnv().STRIPE_SECRET_KEY, {
	apiVersion: "2023-10-16",
	timeout: 1500,
	httpClient,
});
