import type { RequestSchema } from "@mattrax/email";
import { getEnv } from "~/env";

export async function sendEmail(args: RequestSchema) {
	const env = getEnv();

	if (env.FROM_ADDRESS === "console") {
		console.log("SEND EMAIL", args);
		return;
	}

	return fetch(env.EMAIL_URL, {
		method: "POST",
		body: JSON.stringify(args),
		headers: {
			"Content-Type": "application/json",
			Authorization: env.INTERNAL_SECRET,
		},
	});
}
