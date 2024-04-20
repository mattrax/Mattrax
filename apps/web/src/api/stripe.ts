import Stripe from "stripe";
import { env } from "~/env";

const httpClient = Stripe.createFetchHttpClient();

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-04-10",
  timeout: 1500,
  httpClient,
});
