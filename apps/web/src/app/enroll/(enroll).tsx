import { Button, buttonVariants } from "@mattrax/ui/button";
import { CardDescription } from "@mattrax/ui/card";
import { Input } from "@mattrax/ui/input";
import type { APIEvent } from "@solidjs/start/server";
import clsx from "clsx";
import { and, eq } from "drizzle-orm";
import type { ParentProps } from "solid-js";
import { getCookie } from "vinxi/http";
import { getEmailDomain } from "~/api/utils";
import { encryptJWT, verifyJWT } from "~/api/utils/jwt";
import { accounts, db, domains, identityProviders } from "~/db";
import { env } from "~/env";
import { renderWithApp } from "../../entry-server";
import {
	type EnrollmentTokenState,
	Layout,
	MINUTE,
	type State,
	renderMDMCallback,
} from "./util";

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

function FormPage(props: ParentProps<{ continue: boolean; class?: string }>) {
	return (
		<Layout>
			<CardDescription>
				Please enter your company email to get started
			</CardDescription>

			<CardDescription class={clsx("max-w-80 text-center py-4", props.class)}>
				{props.children}
			</CardDescription>

			<form class="pt-2 w-full max-w-80">
				{props.continue ? (
					<input type="hidden" name="continue" value="true" class="hidden" />
				) : null}

				<Input
					type="email"
					name="email"
					placeholder="Email"
					autocomplete="email"
				/>

				<Button type="submit" class="w-full mt-2">
					<span class="text-sm font-semibold leading-6">Enroll</span>
				</Button>
				<script>{formSubmitScript}</script>
			</form>
		</Layout>
	);
}

function AccountButtons() {
	return (
		<div class="flex space-x-4 pt-4">
			<a href="/?action=enrollDevice" class={buttonVariants({})}>
				<span class="text-sm font-semibold leading-6">
					Enroll via dashboard
				</span>
			</a>
			<a href="?continue=true" class={buttonVariants({})}>
				<span class="text-sm font-semibold leading-6">Continue</span>
			</a>
		</div>
	);
}

// This endpoint is fired for:
//   - The browser opening the enrollment UI
//	 - The browser submitting the form on the enrollment UI
//   - After the form submit, being sent to oauth provider and then being redirected back here by `/enroll/callback`
//   - The Windows MDM client webview
//
export async function GET({ request, nativeEvent }: APIEvent) {
	const url = new URL(request.url);

	const continueAuth = url.searchParams.get("continue") === "true";

	// This is set by `/enroll/callback`
	const enroll_session = getCookie(nativeEvent, "enroll_session");

	// This is set by an administrator logging in at `/login`
	const dashboard_session = getCookie(nativeEvent, "auth_session");

	if (dashboard_session && !continueAuth) {
		// We don't validate the session and that's fine because nothing sensitive is being done here.

		return renderWithApp(() => (
			<Layout>
				<CardDescription class="text-center">
					We have detected you are authenticated as an administrator. <br />
					Administrators are only able to enroll devices via the dashboard.
				</CardDescription>
				<AccountButtons />
			</Layout>
		));
	}

	if (enroll_session) {
		const payload = await verifyJWT<EnrollmentTokenState>(
			enroll_session,
			"mdm.mattrax.app",
		);
		if (payload !== null) {
			const p = new URLSearchParams();
			p.set("mode", "mdm");
			p.set("servername", env.ENTERPRISE_ENROLLMENT_URL);
			p.set("username", payload.upn);
			p.set("accesstoken", enroll_session);

			return renderWithApp(() => (
				<Layout>
					<p>
						Enroll a device as <b>{payload.upn}</b>
					</p>
					{/* // TODO: Detect OS and render only the specific stuff for the OS (unless they are an admin then selector) */}
					{/* // TODO: Make this bit look good */}

					{/* // TODO: Handle `onClick` of this for non-Windows platforms */}
					<a href={`ms-device-enrollment:?${p.toString()}`} class="underline">
						Enroll Windows
					</a>

					{/* // TODO: Apple flow */}

					{/* // TODO: Android flow */}

					{/* // TODO: Dropdown for selecting a user when the user is an administrator */}
				</Layout>
			));
		}
	}

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
			<FormPage continue={continueAuth}>
				This will guide your through setting up your device so that your IT
				administrator can keep it secure and provide you with access to
				organisation resources.
			</FormPage>
		));

	// The user already did the login flow in their browser, so we can skip doing it again in within the Windows Federated enrollment flow.
	if (appru && accesstoken) {
		// It seems like Microsoft's MDM client is caching the `accesstoken` prop (as least that's the only explanation for what i'm seeing)
		// This will trigger a new login flow if the token is expired (hence was probs cached).

		// If validation fails we fall though and ask the user to reauthenticate
		if ((await verifyJWT(accesstoken, "mdm.mattrax.app")) !== null)
			return renderMDMCallback(appru, accesstoken);
	}

	// We split the user and domain portion of the email
	const domain = getEmailDomain(email);

	const [[domainRecord], [account]] = await Promise.all([
		db
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
			),
		db
			.select({
				pk: accounts.pk,
			})
			.from(accounts)
			.where(and(eq(accounts.email, email))),
	]);

	if (domainRecord === undefined) {
		if (account !== undefined) {
			return renderWithApp(() => (
				<Layout>
					<CardDescription class="text-center">
						The email <b>{email}</b> is associated with a Mattrax account.
						<br />
						Administrators are only able to enroll devices via the dashboard.
					</CardDescription>
					<AccountButtons />
				</Layout>
			));
		}

		return renderWithApp(() => (
			<FormPage continue={continueAuth} class="text-red-500">
				The email <b>{email}</b> is not connected with Mattrax. Please check
				that you entered your company email correctly.
			</FormPage>
		));
	}

	// Right now we only support AzureAD so we send off the user to do OAuth
	const params = new URLSearchParams({
		client_id: env.ENTRA_CLIENT_ID,
		scope: "https://graph.microsoft.com/.default",
		redirect_uri: `${env.VITE_PROD_ORIGIN}/enroll/callback`,
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
