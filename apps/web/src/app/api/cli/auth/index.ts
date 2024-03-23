import { createId } from "@paralleldrive/cuid2";
import { signJWT } from "~/api/jwt";

import { cliAuthCodes, db } from "~/db";
import { env } from "~/env";

export async function POST() {
	const id = createId();

	await db.insert(cliAuthCodes).values({ code: id });

	return Response.json({
		url: `${env.PROD_URL}/cli/${id}`,
		jwt: await signJWT({ code: id }),
	});
}
