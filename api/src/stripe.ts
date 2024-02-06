// @ts-expect-error // TODO: Fix this properly cause we go no types :(
import Stripe from "stripe-cloudflare";
import { env } from "./env";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});
