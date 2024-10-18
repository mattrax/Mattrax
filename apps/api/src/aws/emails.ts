import type { RequestSchema } from "@mattrax/email";
import { env } from "~/env";
import { aws } from ".";

export async function sendEmail(args: RequestSchema) {
	if (env.FROM_ADDRESS === "console") {
		console.log("SEND EMAIL", args);
		return;
	}

	if (!aws.client) {
		const msg = "AWS client not setup but 'FROM_ADDRESS' provided!";
		console.error(msg);
		throw new Error(msg);
	}

	// We lazy load the email stuff
	await (await import("@mattrax/email").then((mod) => mod._sender))(
		args,
		aws.client,
		env.FROM_ADDRESS,
	);
}
