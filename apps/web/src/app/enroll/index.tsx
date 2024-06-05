import { Button } from "@mattrax/ui/button";
import { CardDescription } from "@mattrax/ui/card";
import { Input } from "@mattrax/ui/input";
import type { APIEvent } from "@solidjs/start/server";
import clsx from "clsx";
import { and, eq } from "drizzle-orm";
import * as jose from "jose";
import type { ParentProps } from "solid-js";
import { getEmailDomain } from "~/api/utils";
import { encryptJWT } from "~/api/utils/jwt";
import { db, domains, identityProviders } from "~/db";
import { env } from "~/env";
import { renderWithApp } from "../../entry-server";
import { Layout, MINUTE, type State, renderMDMCallback } from "./util";

export type EnrollmentProfileDescription = {
	data: string;
	createdAt: number;
};

const formSubmitScript = `const forms = document.getElementsByTagName("form");
for (let i = 0; i < forms.length; i++) {
	forms[i].addEventListener("submit", function () {
		const collection = form.getElementsByTagName("*");
		for (let i = 0; i < collection.length; i++) {
			collection[i].disabled = true;
		}
	})
}`;

function FormPage(props: ParentProps<{ class?: string }>) {
	return (
		<Layout>
			<CardDescription>
				Please enter your company email to get started
			</CardDescription>

			<CardDescription class={clsx("max-w-80 text-center py-4", props.class)}>
				{props.children}
			</CardDescription>

			<form class="pt-4 w-full max-w-80 space-y-2">
				<Input
					type="email"
					name="email"
					placeholder="Email"
					autocomplete="email"
				/>

				<Button type="submit" class="w-full">
					<span class="text-sm font-semibold leading-6">Enroll</span>
				</Button>
				<script>{formSubmitScript}</script>
			</form>
		</Layout>
	);
}

// This endpoint is fired for:
//   - The browser opening the UI
//	 - The browser submitting the form
//   - The Windows MDM client
//
export async function GET({ request }: APIEvent) {
	const url = new URL(request.url);

	// `appru` and `login_hint` are parameters set by Windows MDM client
	const appru = url.searchParams.get("appru");
	// The access token from the `ms-device-enrollment:?` link.
	// This won't be set if the enrollment is started on the device but will be set if the user started in their browser through `/enroll`.
	const accesstoken = url.searchParams.get("accesstoken");

	// `email` is set when coming from the form when submitted `/enroll`, `login_hint` is set by the MDM browser.
	const email =
		url.searchParams.get("email") ?? url.searchParams.get("login_hint");

	// The user just navigated to this page so give them the form to enter their email.
	if (!email)
		return renderWithApp(() => (
			<FormPage>
				This will guide your through setting up your device so that your IT
				administrator can keep it secure and provide you with access to
				organisation resources.
			</FormPage>
		));

	// The user already did the login flow in their browser, so we can skip doing it again in within the Windows Federated enrollment flow.
	if (appru && accesstoken) {
		// It seems like Microsoft's MDM client is caching the `accesstoken` prop (as least that's the only explanation for what i'm seeing)
		// This will trigger a new login flow if the token is expired (hence was probs cached).
		try {
			await jose.jwtVerify(
				accesstoken,
				new TextEncoder().encode(env.INTERNAL_SECRET),
				{
					audience: "mdm.mattrax.app",
					algorithms: ["ES256"],
				},
			);
			return renderMDMCallback(appru, accesstoken);
		} catch (err) {
			// If validation fails we fall though and ask the user to reauthenticate
		}
	}

	// We split the user and domain portion of the email
	const domain = getEmailDomain(email);

	const [domainRecord] = await db
		.select({
			identityProvider: {
				remoteId: identityProviders.remoteId,
				tenantPk: identityProviders.tenantPk,
				pk: identityProviders.pk,
			},
		})
		.from(domains)
		.where(and(eq(domains.domain, domain)))
		.innerJoin(
			identityProviders,
			eq(domains.identityProviderPk, identityProviders.pk),
		);

	if (domainRecord === undefined)
		return renderWithApp(() => (
			<FormPage class="text-red-500">
				The email <b>{email}</b> is not connected with Mattrax. Please check
				that you entered your company email correctly.
			</FormPage>
		));

	// Right now we only support AzureAD so we send off the user to do OAuth
	const params = new URLSearchParams({
		client_id: env.ENTRA_CLIENT_ID,
		scope: "https://graph.microsoft.com/.default",
		redirect_uri: `${env.PROD_ORIGIN}/enroll/callback`,
		response_type: "code",
		response_mode: "query",
		login_hint: email,
		state: await encryptJWT<State>(
			{
				appru,
				tenantId: domainRecord.identityProvider.remoteId,
				tid: domainRecord.identityProvider.tenantPk,
				providerId: domainRecord.identityProvider.pk,
			},
			{
				expirationTime: new Date(Date.now() + 10 * MINUTE),
				audience: "enroll",
			},
		),
	});

	return Response.redirect(
		`https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?${params.toString()}`,
	);
}
