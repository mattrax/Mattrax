import { Hono } from "hono";

export const webhookRouter = new Hono().post("/ms", async (c) => {
  console.log("ms webhook");
  console.log(c.req.query("validationToken"));
  return c.text("");
});

// TODO: Listen to Stripe webhooks - https://stripe.com/docs/customer-management/integrate-customer-portal#webhooks
