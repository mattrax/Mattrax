/* @refresh reload */
import { initDatabase } from "./sync";

const clientId = "5dd42e00-78e7-474a-954a-bb4e5085e820";

export async function generateOAuthUrl() {
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

	// TODO: Move this into the sync engine
	const data = await resp.json();

	const user = await fetch("https://graph.microsoft.com/v1.0/me", {
		headers: {
			Authorization: `Bearer ${data.access_token}`,
		},
	});
	if (!user.ok) throw new Error("Failed to fetch user");

	initDatabase(data.access_token, data.refresh_token, await user.json());
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
