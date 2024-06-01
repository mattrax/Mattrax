import { CLOUDFLARE_ACCOUNT, CLOUDFLARE_ZONE } from "./constants";

export const domainZone = new cloudflare.Zone(
	"MattraxCloudflareZone",
	{ accountId: CLOUDFLARE_ACCOUNT, zone: CLOUDFLARE_ZONE, plan: "free" },
	{ protect: true },
);
