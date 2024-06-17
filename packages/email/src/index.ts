import { render } from "@react-email/render";
import type { AwsClient } from "aws4fetch";
import { z } from "zod";

import LoginCodeEmail from "../emails/LoginCode";
import TenantAdminInviteEmail from "../emails/TenantAdminInvite";
import UserEnrollmentInviteEmail from "../emails/UserEnrollmentInvite";

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

export async function _sender(
	args: RequestSchema,
	aws: AwsClient,
	fromAddress: string,
) {
	let component: any;
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
				FromEmailAddress: fromAddress,
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
