import { AwsClient } from "aws4fetch";
import { render } from "@react-email/render";
import { env } from "~/env";
import {
	LoginCodeEmail,
	TenantAdminInviteEmail,
	UserEnrollmentInviteEmail,
} from "../emails";
import type { RequestSchema } from "~/api/emails";

const aws =
	env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
		? new AwsClient({
				region: "us-east-1",
				accessKeyId: env.AWS_ACCESS_KEY_ID,
				secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
			})
		: undefined;

export { default as TenantAdminInviteEmail } from "./TenantAdminInvite.email";
export { default as LoginCodeEmail } from "./LoginCode.email";
export { default as UserEnrollmentInviteEmail } from "./UserEnrollmentInvite.email";

export async function _sender(args: RequestSchema) {
	if (!aws) {
		const msg = "AWS client not setup but 'FROM_ADDRESS' provided!";
		console.error(msg);
		throw new Error(msg);
	}

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
