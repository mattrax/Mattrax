import type { ParentProps } from "solid-js";
import { renderToString } from "solid-js/web";
import { signJWT } from "~/api/utils/jwt";

export const MINUTE = 60 * 1000;

type AllOrNone<T> = T | { [K in keyof T]?: never };

export type EnrollmentTokenState = {
	tid: number;
	aid?: number;
} & AllOrNone<{
	uid: number;
	upn: string;
}>;

// TODO: Enrollment sessions could be reused.
// TODO: It would be nice if we could keep them in the DB and allow the admin to view and remove them.
export function createEnrollmentSession(
	state: EnrollmentTokenState,
	minutesFromNowForExpiry: number,
) {
	return signJWT<EnrollmentTokenState>(state, {
		expirationTime: new Date(Date.now() + minutesFromNowForExpiry * MINUTE),
		audience: "mdm.mattrax.app",
	});
}

export type State = {
	// MDM webview special callback URL
	appru: string | null;
	// Microsoft tenantID
	tenantId: string;
	// Mattrax id's
	tid: number;
	providerId: number;
};

export function Layout(props: ParentProps) {
	return (
		<div id="app" class="flex min-h-full flex-col">
			<div class="flex-grow flex justify-center items-center">
				<div class="w-full flex flex-col items-center justify-center">
					<div class="sm:mx-auto sm:w-full sm:max-w-md flex items-center justify-center pb-2">
						<h2 class="mt-4 text-center text-4xl font-bold leading-9 tracking-tight text-gray-900">
							Mattrax
						</h2>
					</div>

					{props.children}
				</div>
			</div>
		</div>
	);
}

// Rendered within the MDM webview to submit the auth token back to it.
export const renderMDMCallback = (appru: string, authToken: string) =>
	new Response(
		renderToString(() => (
			<>
				<h3>Mattrax Login</h3>
				<form id="loginForm" method="post" action={appru}>
					<p>
						<input type="hidden" name="wresult" value={authToken} />
					</p>
					<input type="submit" value="Login" />
				</form>
				<script>document.getElementById('loginForm').submit()</script>
			</>
		)),
		{
			headers: {
				"Content-Type": "text/html",
			},
		},
	);
