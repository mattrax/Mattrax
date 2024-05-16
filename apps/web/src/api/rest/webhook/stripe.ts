import { Hono } from "hono";

// TODO: Listen to Stripe webhooks - https://stripe.com/docs/customer-management/integrate-customer-portal#webhooks

export const stripeRouter = new Hono();
