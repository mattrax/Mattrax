import Stripe from "stripe";
import { env } from "./env";

const httpClient = Stripe.createFetchHttpClient();

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
  timeout: 1500,
  httpClient,
});
