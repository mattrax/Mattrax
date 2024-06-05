import type { APIEvent } from "@solidjs/start/server";
import type { ParentProps } from "solid-js";
import { Layout, MINUTE, renderMDMCallback, type State } from "./util";
import { CardDescription } from "@mattrax/ui/card";
import { renderWithApp } from "~/entry-server";
import { decryptJWT, signJWT } from "~/api/utils/jwt";
import { env } from "~/env";
import { upsertEntraIdUser } from "~/api/trpc/routers/tenant/identityProvider";

function ErrorPage(props: ParentProps<{ class?: string }>) {
	return (
		<Layout>
			<CardDescription>Something went wrong. Please try again.</CardDescription>

			<CardDescription class="max-w-80 text-center py-4 text-red-500">
				{props.children}
			</CardDescription>

			<a href="/enroll" target="_self" class="underline">
				Go back
			</a>
		</Layout>
	);
}

export async function GET({ request }: APIEvent) {
	const url = new URL(request.url);

	const stateStr = url.searchParams.get("state");
	const code = url.searchParams.get("code");
	if (!stateStr || !code)
		return renderWithApp(() => (
			<ErrorPage>This page was accessed incorrectly</ErrorPage>
		));
	const stateJwt = await decryptJWT(stateStr, {
		audience: "enroll",
	});
	const { appru, tenantId, tid, providerId } = stateJwt.payload as State;

	const access_token = await getToken(tenantId, code);
	if (!access_token)
		return renderWithApp(() => (
			<ErrorPage>Failed to verify your identity with Microsoft</ErrorPage>
		));

	const user = await getUser(access_token);
	if (!user)
		return renderWithApp(() => (
			<ErrorPage>Failed to retrieve your information from Microsoft</ErrorPage>
		));

	const { userPrincipalName } = user;
	const dbUser = await upsertEntraIdUser(user, tid, providerId);
	// TODO: Upsert if the user doesn't exist already
	const jwt = await signJWT(
		{ tid, uid: dbUser.pk, upn: userPrincipalName },
		{
			expirationTime: new Date(Date.now() + 10 * MINUTE),
			audience: "mdm.mattrax.app",
		},
	);
	if (appru) return renderMDMCallback(appru, jwt);

	const p = new URLSearchParams();
	p.set("mode", "mdm");
	p.set("servername", env.ENTERPRISE_ENROLLMENT_URL);
	p.set("username", userPrincipalName);
	p.set("accesstoken", jwt);

	// TODO: We should set a cookie and redirect somewhere else (maybe `/enroll`?)
	// TODO: This will remove the access token from the URL and allow a browser refresh to not break everything.

	return renderWithApp(() => (
		<Layout>
			{/* // TODO: Detect OS and render only the specific stuff for the OS (unless they are an admin then selector) */}
			{/* // TODO: Make this bit look good */}

			<a href={`ms-device-enrollment:?${p.toString()}`} class="underline">
				Enroll Windows
			</a>

			{/* // TODO: Apple flow */}

			{/* // TODO: Android flow */}

			<a href="/enroll" target="_self" class="underline">
				Go back
			</a>
		</Layout>
	));
}

async function getToken(tenantId: string, code: string) {
	const resp = await fetch(
		`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
		{
			method: "POST",
			body: new URLSearchParams({
				client_id: env.ENTRA_CLIENT_ID,
				client_secret: env.ENTRA_CLIENT_SECRET,
				scope: "https://graph.microsoft.com/.default",
				redirect_uri: `${env.PROD_ORIGIN}/enroll/callback`,
				grant_type: "authorization_code",
				code,
			}),
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
		},
	);
	if (!resp.ok) {
		console.error(
			`Failed to get access token '${resp.status}': ${await resp.text()}`,
		);
		return undefined;
	}
	return (await resp.json())?.access_token;
}

async function getUser(access_token: string) {
	const resp = await fetch("https://graph.microsoft.com/v1.0/me", {
		headers: {
			Authorization: `Bearer ${access_token}`,
		},
	});

	if (!resp.ok) {
		console.error(`Failed to get user '${resp.status}': ${await resp.text()}`);
		return undefined;
	}

	return await resp.json();
}
