import { Hono } from "hono";

import { stripeRouter } from "./stripe";
import { microsoftGraphRouter } from "./microsoft-graph";

export const webhookRouter = new Hono()
  .route("/microsoft-graph", microsoftGraphRouter)
  .route("/stripe", stripeRouter);
