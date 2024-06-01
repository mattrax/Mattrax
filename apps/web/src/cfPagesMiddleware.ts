import { createMiddleware } from "@solidjs/start/middleware";
import { fromCloudflareEnv } from "sst";

export default createMiddleware({
	onRequest: [
		(event) => {
			fromCloudflareEnv(event.nativeEvent.context.cloudflare?.env ?? {});
		},
	],
});
