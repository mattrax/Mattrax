import type { AwsClient } from "aws4fetch";
import { z } from "zod";
import { emails } from "./emails.gen";

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
	const emailHtml = emails[args.type](args as any);

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
