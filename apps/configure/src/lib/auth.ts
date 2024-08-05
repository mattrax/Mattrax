import { useNavigate } from "@solidjs/router";
import { openAndInitDb } from "./db";
import { getKey, setKey } from "./kv";
import { createDbQuery } from "./query";

const clientId = "5dd42e00-78e7-474a-954a-bb4e5085e820";

export async function generateOAuthUrl(
	prompt?: "none" | "login" | "consent" | "select_account" | undefined,
) {
	const codeVerifier = generateRandomString(64);
	window.sessionStorage.setItem("code_verifier", codeVerifier);

	const params = new URLSearchParams({
		client_id: clientId,
		response_type: "code",
		redirect_uri: window.origin,
		response_mode: "query",
		scope: "https://graph.microsoft.com/.default",
		code_challenge: await generateCodeChallenge(codeVerifier),
		code_challenge_method: "S256",
		...(prompt ? { prompt } : {}),
		// TODO: `login_hint`
	});

	return `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function verifyOAuthCode(code: string) {
	const code_verifier = sessionStorage.getItem("code_verifier");
	if (!code_verifier) throw new Error("Code verifier not found");

	const resp = await fetch(
		"https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
		{
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				client_id: clientId,
				scope: "https://graph.microsoft.com/.default",
				code,
				redirect_uri: window.origin,
				grant_type: "authorization_code",
				code_verifier,
			}),
		},
	);
	if (!resp.ok) throw new Error("Failed to verify code");
	sessionStorage.removeItem("code_verifier");

	const data = await resp.json();

	const user = await fetch("https://graph.microsoft.com/v1.0/me?$select=id", {
		headers: { Authorization: `Bearer ${data.access_token}` },
	});
	if (!user.ok) throw new Error("Failed to fetch user");

	// TODO: Validate the user & access_tokens against Zod schema

	const userId = (await user.json()).id;

	const db = await openAndInitDb(userId, true);
	await setKey(db, "accessToken", data.access_token);
	await setKey(db, "refreshToken", data.refresh_token);

	return userId;
}

const possible =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function generateRandomString(length: number) {
	let text = "";
	for (let i = 0; i < length; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}

	return text;
}

async function generateCodeChallenge(codeVerifier: string) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(codeVerifier),
	);

	return btoa(String.fromCharCode(...new Uint8Array(digest)))
		.replace(/=/g, "")
		.replace(/\+/g, "-")
		.replace(/\//g, "_");
}

export function useUser() {
	const navigate = useNavigate();
	return createDbQuery(async (db) => {
		const user = await getKey(db, "user");
		if (!user) {
			const accessToken = await getKey(db, "accessToken");
			if (!accessToken) {
				navigate("/");
				await new Promise((resolve) => {});
			}

			// TODO: We are taking a risk that if DB updates come in now, we will fetch the user multiple times.
			// TODO: Maybe implement this as a partial sync???

			const userData = await fetch("https://graph.microsoft.com/v1.0/me", {
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
			});
			// TODO: Zod validation on fetch + handle unauthorised redirect.
			const user = mapUser(await userData.json());
			await setKey(await db, "user", user);
			return user;
		}
		return user;
	});
}

// TODO: Really this should go in `schema.ts` and not be exported???
// Convert between a Microsoft Graph user object and our internal user object.
export function mapUser(data: any) {
	return {
		id: data.id,
		name: data.displayName,
		upn: data.userPrincipalName,
		avatar: undefined as string | undefined,
		avatarEtag: undefined as string | undefined,
	};
}

export type User = ReturnType<typeof mapUser>;
