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
  .post("/sns", async (c) => {
    const message = await asyncSnsValidator(await c.req.json());
    if (!message) throw new Error("Invalid SNS message");

    if (message?.["Type"] === "SubscriptionConfirmation") {
      await fetch(message["SubscribeURL"] as string);
    } else if (message?.["Type"] === "Notification") {
      console.log("SNS NOTIFICATION", message);
      console.log(message.Subject, message.Message);
    }

    return c.json({});
  });
