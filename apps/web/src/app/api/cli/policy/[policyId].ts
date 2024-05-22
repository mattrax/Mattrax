import { createId } from "@paralleldrive/cuid2";
import type { APIEvent } from "@solidjs/start/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { generatePolicyDiff } from "~/api/trpc/routers/policy";
import { db, policies, policyDeploy } from "~/db";

export async function GET({ params }: APIEvent) {
	throw new Error("THE CLI IS NOT SUPPORTED YET");

	// const policyId = params.policyId as string;

	// // TODO: Auth and Authz

	// const [policy] = await db
	//   .select({
	//     name: policies.name,
	//     data: policies.data,
	//   })
	//   .from(policies)
	//   .where(eq(policies.id, policyId));

	// return policy;
}

const schema = z.object({
	name: z.string(),
	// TODO: Can we properly validate this
	data: z.any(),
	// Not providing a comment, will skip deploying the policy
	comment: z.string().nullable(),
});

// TODO: Use Specta for return type so it's E2E typesafe
export async function POST({ request, params }: APIEvent) {
	throw new Error("THE CLI IS NOT SUPPORTED YET");

	// const policyId = params.policyId as string;
	// const body = schema.safeParse(await request.json());

	// if (!body.success)
	//   return new Response("Error parsing request!", {
	//     status: 400,
	//   });

	// const [policy] = await db
	//   .select({
	//     pk: policies.pk,
	//     tenantPk: policies.tenantPk,
	//     data: policies.data,
	//   })
	//   .from(policies)
	//   .where(eq(policies.id, policyId));
	// if (!policy)
	//   return new Response("404: Policy not found", {
	//     status: 404,
	//   });

	// // TODO: Auth and Authz
	// const authorId = 2;

	// const [lastVersion] = await db
	//   .select({ data: policyDeploy.data })
	//   .from(policyDeploy)
	//   .where(and(eq(policyDeploy.policyPk, policy.pk)))
	//   .orderBy(desc(policyDeploy.doneAt))
	//   .limit(1);

	// if (
	//   generatePolicyDiff(lastVersion?.data ?? ({} as any), body.data.data)
	//     .length === 0
	// )
	//   return Response.json(["unchanged", null]);

	// const updatePolicy = () =>
	//   db
	//     .update(policies)
	//     .set({
	//       name: body.data.name,
	//       data: body.data.data,
	//     })
	//     .where(eq(policies.id, policyId));

	// if (body.data.comment) {
	//   const comment = body.data.comment;

	//   const versionId = createId();
	//   await db.transaction(async (db) => {
	//     await updatePolicy();
	//     await db.insert(policyDeploy).values({
	//       id: versionId,
	//       policyPk: policy.pk,
	//       data: body.data.data,
	//       comment,
	//       author: authorId,
	//     });
	//   });

	//   return Response.json(["deployed", versionId]);
	// }

	// await updatePolicy();
	// return Response.json(["updated", null]);
}
