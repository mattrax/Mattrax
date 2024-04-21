import { createId } from "@paralleldrive/cuid2";
import { signJWT } from "~/api/jwt";

import { cliAuthCodes, getDb } from "~/db";
import { env } from "~/env";

export async function POST() {
	// TODO: Authenticated user

	const id = createId();

	await getDb().insert(cliAuthCodes).values({ code: id });

	return Response.json({
		url: `${env.VITE_PROD_URL}/cli/${id}`,
		jwt: await signJWT({ code: id }),
	});
}
