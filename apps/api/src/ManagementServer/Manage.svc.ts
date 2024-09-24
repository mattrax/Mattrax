import type { APIEvent } from "@solidjs/start/server";

export async function GET({ request }: APIEvent) {
	const body = await request.text();

	const apiGatewayAuth = request.headers.get("x-apigateway-auth");
	const clientCert = request.headers.get("x-client-cert");

	console.log("MANAGEMENT", apiGatewayAuth, clientCert, body);

	// TODO: Authenticate client

	return new Response("");
}
