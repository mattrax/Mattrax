import { z } from "zod";
import { env } from "~/env";

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

	// We lazy load to keep React + React email outta the main bundle
	(await import("../emails/index").then((mod) => mod._sender))(args);
}
