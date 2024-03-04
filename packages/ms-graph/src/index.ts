import { Client, GraphError } from "@microsoft/microsoft-graph-client";
import { AuthProvider } from "./authProvider";

// Unused but makes TS happy.
export type { Client } from "@microsoft/microsoft-graph-client";

export const initGraphClient = (
	tenantId: string,
	clientId: string,
	clientSecret: string,
) =>
	Client.initWithMiddleware({
		authProvider: new AuthProvider(tenantId, clientId, clientSecret),
	});

export function isGraphError(err: any): err is GraphError {
	return err instanceof GraphError;
}
export function isNotFoundGraphError(err: any): err is GraphError {
	return isGraphError(err) && err.code === "Request_ResourceNotFound";
}
