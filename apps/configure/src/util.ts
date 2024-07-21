import { createSignal } from "solid-js";

const clientId = "5dd42e00-78e7-474a-954a-bb4e5085e820";

// TODO: Keep this in the component lifecycle
export const [accessToken, setAccessToken] = createSignal(
	localStorage.getItem("access_token"),
);

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

export async function verifyCode(code: string) {
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
	localStorage.setItem(
		"access_token",
		`${data.token_type} ${data.access_token}`,
	);
	setAccessToken(`${data.token_type} ${data.access_token}`);
	localStorage.setItem("refresh_token", data.refresh_token);
	localStorage.setItem("expires_in", data.expires_in);
	return data.access_token;
}

export function logout() {
	// TODO: Can we ask Microsoft to burn the token?

	setAccessToken(null);
	localStorage.removeItem("access_token");
	localStorage.removeItem("refresh_token");
	localStorage.removeItem("expires_in");
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
