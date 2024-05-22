import { render } from "@react-email/render";
// @ts-expect-error
import { createEnv } from "@t3-oss/env-core";
import { AwsClient } from "aws4fetch";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { LoginCodeEmail, TenantAdminInviteEmail } from "~/emails";
import UserEnrollmentInvite from "~/emails/UserEnrollmentInvite";

function optional_in_dev<T extends z.ZodTypeAny>(
	schema: T,
): z.ZodOptional<T> | T {
	return process.env.NODE_ENV === "development" ? schema.optional() : schema;
}

const env = createEnv({
	server: {
		// Emails and other AWS services
		// Get these values from the output of the Cloudformation template
		AWS_ACCESS_KEY_ID: optional_in_dev(z.string()),
		AWS_SECRET_ACCESS_KEY: optional_in_dev(z.string()),
		// Email
		FROM_ADDRESS: z.string(),
		INTERNAL_SECRET: z.string(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});

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

export async function POST(req: NextRequest) {
	const auth = req.headers.get("authorization");
	if (auth !== env.INTERNAL_SECRET) {
		return new Response("Unauthorized", { status: 401 });
	}

	const args = REQUEST_SCHEMA.parse(await req.json());

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
		component = UserEnrollmentInvite(args);
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

	return new Response("Email sent", { status: 200 });
}
