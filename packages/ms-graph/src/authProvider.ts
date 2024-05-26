// An authentication provider for Microsoft Graph.
// We use a custom implementation because the Azure package doesn't support Cloudflare Workers.

import type { AuthenticationProvider } from "@microsoft/microsoft-graph-client";
import { z } from "zod";

const authenticateResponse = z.object({
	token_type: z.string(),
	expires_in: z.number(),
	ext_expires_in: z.number(),
	access_token: z.string(),
});

// We don't use `@azure/identity` because it pulls in Node.js only dependencies which are not supported on Edge Function's :(
export class AuthProvider implements AuthenticationProvider {
	tenant: string;
	clientId: string;
	clientSecret: string;
	refreshToken: string | undefined;

	constructor(
		tenant: string,
		clientId: string,
		clientSecret: string,
		refreshToken?: string,
	) {
		this.tenant = tenant;
		this.clientId = clientId;
		this.clientSecret = clientSecret;
		this.refreshToken = refreshToken;
	}

	// TODO: Properly implement refresh when the token expires
	public async getAccessToken(): Promise<string> {
		const params = new URLSearchParams({
			client_id: this.clientId,
			client_secret: this.clientSecret,
			scope: "https://graph.microsoft.com/.default",
			grant_type:
				this.refreshToken !== undefined
					? "refresh_token"
					: "client_credentials",
		});
		if (this.refreshToken !== undefined)
			params.append("refresh_token", this.refreshToken);

		const resp = await fetch(
			`https://login.microsoftonline.com/${encodeURIComponent(
				this.tenant,
			)}/oauth2/v2.0/token`,
			{
				method: "POST",
				headers: new Headers({
					// This is implied by `URLSearchParams` but Vercel Edge Runtime is stupid
					"Content-Type": "application/x-www-form-urlencoded",
				}),
				body: params,
			},
		);
		if (!resp.ok) {
			const body = await resp.text();
			console.error(resp.status, body);
			throw new FetchError(
				resp.status,
				body,
				"Failed to get access token from Microsoft",
			);
		}
		const result = authenticateResponse.safeParse(await resp.json());
		if (!result.success) {
			console.error(
				`Failed to parse Microsoft authenticate response: ${result.error}`,
			);
			throw new Error(
				`Failed to parse Microsoft authenticate response: ${result.error}`,
			);
		}

		return result.data.access_token;
	}
}

export class FetchError {
	status = 0;
	body: string | undefined = undefined;
	msg: string | undefined = undefined;

	constructor(status: number, body: string | undefined, msg?: string) {
		this.status = status;
		this.body = body;
		this.msg = msg;
	}

	toString() {
		return `FetchError: ${this.msg}; status=${
			this.status
		} body='${JSON.stringify(this.body)}'`;
	}
}
