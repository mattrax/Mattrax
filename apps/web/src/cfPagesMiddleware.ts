import { createMiddleware } from "@solidjs/start/middleware";
import { fromCloudflareEnv } from "sst";

import { Resource } from "sst";

export default createMiddleware({
	onRequest: [
		(event) => {
			const env = event.nativeEvent.context.cloudflare?.env ?? {};

			fromCloudflareEnv(env);

			console.log({ ...Resource });
		},
	],
});
