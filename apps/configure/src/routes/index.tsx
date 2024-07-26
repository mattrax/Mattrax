import { buttonVariants } from "@mattrax/ui";
import { createAsync, useLocation, useNavigate } from "@solidjs/router";
import { ErrorBoundary, Match, Suspense, Switch } from "solid-js";
import { generateOAuthUrl, verifyOAuthCode } from "~/lib/auth";
import { db, subscribeToInvalidations } from "~/lib/db";

export default function Page() {
	const location = useLocation();
	const navigate = useNavigate();

	const checkAuth = async () => {
		const accessToken = await (await db).get("_kv", "accessToken");
		const user = await (await db).get("_kv", "user");
		if (user && accessToken) navigate("/overview", { replace: true });
	};
	checkAuth();
	subscribeToInvalidations((store) => {
		if (store === "auth") checkAuth();
	});

	return (
		<div class="p-4">
			<Switch fallback={<UnauthenticatedApp />}>
				<Match when={location.query?.error !== undefined}>
					<p class="bg-red-500">
						{location.query?.error_description || location.query?.error}
					</p>
				</Match>
				<Match when={location.query?.code} keyed>
					{(code) => {
						const accessToken = createAsync(async () => {
							await verifyOAuthCode(code);
							navigate("/overview", { replace: true });
						});

						return (
							<ErrorBoundary
								fallback={
									<>
										<p>Error verifying access token! Please try again!</p>
										<a href="/" class={buttonVariants()}>
											Try again
										</a>
									</>
								}
							>
								<Suspense fallback={<p>Verifying...</p>}>
									{accessToken() ? null : null}
								</Suspense>
							</ErrorBoundary>
						);
					}}
				</Match>
			</Switch>
		</div>
	);
}

function UnauthenticatedApp() {
	const loginUrl = createAsync(() => generateOAuthUrl());

	return (
		<Suspense>
			<h1 class="uppercase font-extrabold text-2xl mb-4">Mattrax Configure</h1>
			<a href={loginUrl()} class={buttonVariants()}>
				Login
			</a>
		</Suspense>
	);
}
