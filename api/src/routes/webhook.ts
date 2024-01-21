import { z } from "zod";
import { env } from "../env";
import { newApp } from "../utils";
import { basicAuth } from "hono/basic-auth";
import MessageValidator from "sns-validator";

const validator = new MessageValidator();

const asyncSnsValidator = (body: string | Record<string, unknown>) =>
  new Promise<Record<string, unknown> | undefined>((resolve, reject) =>
    validator.validate(body, async (err, message) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(message);
    })
  );

export const app = newApp()
  .use(
    "*",
    // Look this isn't "super" secure but we don't trust the request body anyway.
    basicAuth({
      username: "sns",
      password: env.SNS_SHARED_SECRET,
    })
  )
  .get("/sns", async (c) => {
    const body = await c.req.json();

    // TODO: Finish this
    await fetch("https://webhook.site/6fe25dc3-4a2c-4559-a221-772156ca5971", {
      method: "POST",
      body: JSON.stringify("HIT"),
      headers: {
        "Content-Type": "application/json",
      },
    });

    try {
      const input = await asyncSnsValidator(body);

      // TODO: Finish this
      await fetch("https://webhook.site/6fe25dc3-4a2c-4559-a221-772156ca5971", {
        method: "POST",
        body: JSON.stringify(input),
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (e) {
      console.error(e);

      await fetch("https://webhook.site/6fe25dc3-4a2c-4559-a221-772156ca5971", {
        method: "POST",
        body: JSON.stringify({
          error: e.toString(),
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    return c.json({});
  });
