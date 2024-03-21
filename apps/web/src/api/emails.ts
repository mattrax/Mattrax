import type { RequestSchema } from "@mattrax/email";
import { env } from "~/env";

export async function sendEmail(args: RequestSchema) {
	if (env.FROM_ADDRESS === "console") {
		console.log("SEND EMAIL", args);
		return;
	}

	const resp = await fetch(env.EMAIL_URL, {
		method: "POST",
		body: JSON.stringify(args),
		headers: {
			"Content-Type": "application/json",
			Authorization: env.INTERNAL_SECRET,
		},
	});
	if (!resp.ok)
		console.error(`Failed to send email: ${resp.status} ${await resp.text()}`);
}
