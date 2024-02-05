import type { JSX as ReactJSX } from "react";
import { render } from "@react-email/render";
import { AwsClient } from "aws4fetch";
import { env } from "./env";

const aws =
  env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
    ? new AwsClient({
        region: "us-east-1",
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      })
    : undefined;

type SendEmailArgs = {
  to: string;
  subject: string;
  component: ReactJSX.Element;
};

export async function sendEmail(args: SendEmailArgs) {
  if (env.FROM_ADDRESS === "console") {
    console.log("SEND EMAIL", args);
    return;
  }

  if (!aws) {
    const msg = "AWS client not setup but 'FROM_ADDRESS' provided!";
    console.error(msg);
    throw new Error(msg);
  }

  const emailHtml = render(args.component);
  const resp = await aws.fetch(
    "https://email.us-east-1.amazonaws.com/v2/email/outbound-emails",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        FromEmailAddress: env.FROM_ADDRESS,
        Destination: {
          ToAddresses: [args.to],
        },
        Content: {
          Simple: {
            Body: {
              Html: {
                Charset: "UTF-8",
                Data: "todo", // emailHtml,
              },
            },
            Subject: {
              Charset: "UTF-8",
              Data: args.subject,
            },
          },
        },
      }),
    }
  );
  if (!resp.ok) {
    console.error(
      `Error sending email with SES status '${
        resp.status
      }': ${await resp.text()}`
    );
    throw new Error("Failed to send email.");
  }
}
