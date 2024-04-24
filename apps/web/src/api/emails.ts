import type { JSX } from "react";
import { AwsClient } from "aws4fetch";
import { render } from "@react-email/render";
import { z } from "zod";
import { env } from "~/env";
import {
	LoginCodeEmail,
	TenantAdminInviteEmail,
	UserEnrollmentInviteEmail,
} from "../emails";

const aws =
	env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
		? new AwsClient({
				region: "us-east-1",
				accessKeyId: env.AWS_ACCESS_KEY_ID,
				secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
			})
		: undefined;

const REQUEST_SCHEMA = z
	.object({
		to: z.string(),
		subject: z.string(),
	})
	.and(
		z.union([
			z.object({
				type: z.literal("tenantAdminInvite"),
				invitedByEmail: z.string(),
				tenantName: z.string(),
				inviteLink: z.string(),
			}),
			z.object({
				type: z.literal("loginCode"),
				code: z.string(),
			}),
			z.object({
				type: z.literal("userEnrollmentInvite"),
				tenantName: z.string(),
			}),
		]),
	);

export type RequestSchema = z.infer<typeof REQUEST_SCHEMA>;

export async function sendEmail(args: RequestSchema) {
	if (env.FROM_ADDRESS === "console") {
		console.log("SEND EMAIL", args);
		return;
	}

	if (!aws) {
		const msg = "AWS client not setup but 'FROM_ADDRESS' provided!";
		console.error(msg);
		throw new Error(msg);
	}

	let component: JSX.Element;

	if (args.type === "tenantAdminInvite") {
		component = TenantAdminInviteEmail(args);
	} else if (args.type === "loginCode") {
		component = LoginCodeEmail(args);
	} else if (args.type === "userEnrollmentInvite") {
		component = UserEnrollmentInviteEmail(args);
	} else {
		throw new Error("Unknown email type");
	}

	const emailHtml = render(component);
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
								Data: emailHtml,
							},
						},
						Subject: {
							Charset: "UTF-8",
							Data: args.subject,
						},
					},
				},
			}),
		},
	);
	if (!resp.ok) {
		console.error(
			`Error sending email with SES status '${
				resp.status
			}': ${await resp.text()}`,
		);
		throw new Error("Failed to send email.");
	}
}
