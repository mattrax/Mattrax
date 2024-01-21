import { env } from "../env";
import { newApp } from "../utils";
import { basicAuth } from "hono/basic-auth";

export const app = newApp()
  .use(
    "*",
    // Look this isn't "super" secure but we don't trust the request body anyway.
    basicAuth({
      username: "sns",
      password: env.AWS_ACCESS_KEY_ID,
    })
  )
  .get("/sns", async (c) => {
    const body = await c.req.text();
    console.log("SNS Webhook Hit!", body);

    return c.json({});
  });
