import { createId } from "@paralleldrive/cuid2";
import { signJWT } from "~/api/utils/jwt";

import { cliAuthCodes, db } from "~/db";
import { env } from "~/env";

export async function POST() {
	throw new Error("THE CLI IS NOT SUPPORTED YET");

	// TODO: Authenticated user

	const id = createId();

	await db.insert(cliAuthCodes).values({ code: id });

	return Response.json({
		url: `${env.PROD_ORIGIN}/cli/${id}`,
		jwt: await signJWT({ code: id }),
	});
}
