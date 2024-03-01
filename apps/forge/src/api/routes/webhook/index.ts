import { Hono } from "hono";

import { msRouter } from "../ms";
import { stripeRouter } from "./stripe";

export const webhookRouter = new Hono()
  .route("/ms", msRouter)
  .route("/stripe", stripeRouter);
