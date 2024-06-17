import { Client } from "@microsoft/microsoft-graph-client";
import { AuthProvider } from "./authProvider";

// Unused but makes TS happy.
export type { Client } from "@microsoft/microsoft-graph-client";

export const initGraphClient = (
	tenantId: string,
	clientId: string,
	clientSecret: string,
	refreshToken?: string,
) => {
	return Client.initWithMiddleware({
		authProvider: new AuthProvider(
			tenantId,
			clientId,
			clientSecret,
			refreshToken,
		),
	});
};
