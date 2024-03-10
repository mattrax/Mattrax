import type { RequestSchema } from "@mattrax/email";
import { getEnv } from "~/env";

export async function sendEmail(args: RequestSchema) {
	if (getEnv().FROM_ADDRESS === "console") {
		console.log("SEND EMAIL", args);
		return;
	}

	return fetch(getEnv().EMAIL_URL, {
		method: "POST",
		body: JSON.stringify(args),
		headers: {
			"Content-Type": "application/json",
			Authorization: getEnv().INTERNAL_SECRET,
		},
	});
}
