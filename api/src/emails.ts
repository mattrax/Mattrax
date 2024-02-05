import type { JSX as ReactJSX } from "react";
import { render } from "@react-email/render";
import { SES, SendEmailCommand } from "@aws-sdk/client-ses";
import { env } from "./env";

const ses = new SES({
  region: "us-east-1",
  ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        },
      }
    : {}),
});

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

  const emailHtml = render(args.component);
  const cmd = new SendEmailCommand({
    Destination: {
      ToAddresses: [args.to],
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: emailHtml,
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: args.subject,
      },
    },
    Source: env.FROM_ADDRESS,
    ReplyToAddresses: [],
  });

  try {
    return await ses.send(cmd);
  } catch (err) {
    console.error("Failed to send email.", err);
    return err;
  }
}
