import { z } from "zod";
import type { APIEvent } from "@solidjs/start/server";
import { db, policies } from "~/db";
import { eq } from "drizzle-orm";

export async function GET({ params }: APIEvent) {
	const policyId = params.policyId as string;

	// TODO: Auth and Authz

	const [policy] = await db
		.select({
			name: policies.name,
			data: policies.data,
		})
		.from(policies)
		.where(eq(policies.id, policyId));

	return policy;
}

const schema = z.object({
	name: z.string(),
	// TODO: Can we properly validate this
	data: z.any(),
});

export async function POST({ request, params }: APIEvent) {
	const policyId = params.policyId as string;

	// TODO: Auth and Authz

	const body = schema.safeParse(await request.json());
	if (!body.success)
		return new Response("Error parsing request!", {
			status: 400,
		});

	await db
		.update(policies)
		.set({
			name: body.data.name,
			data: body.data.data,
		})
		.where(eq(policies.id, policyId));

	return new Response("", {
		status: 201,
	});
}
