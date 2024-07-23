import { buttonVariants } from "@mattrax/ui";
import {
	Navigate,
	createAsync,
	useLocation,
	useNavigate,
} from "@solidjs/router";
import { ErrorBoundary, Match, Suspense, Switch } from "solid-js";
import {
	fetchAndCacheUserData,
	generateOAuthUrl,
	verifyOAuthCode,
} from "~/lib/auth";
import { useAccessTokenRaw } from "./(dash)";

export default function Page() {
	const location = useLocation();
	const navigate = useNavigate();
	const accessToken = useAccessTokenRaw();

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
						const access_token = createAsync(async () => {
							const token = await verifyOAuthCode(code);
							await fetchAndCacheUserData(token);

							// Clear the query params
							navigate("/");
						});

						return (
							<ErrorBoundary
								fallback={
									<>
										<p>Error verifying access token! Please try again!</p>
										<a href="/" class={buttonVariants()}>
											Try again...
										</a>
									</>
								}
							>
								<Suspense fallback={<p>Verifying...</p>}>
									{access_token() ? null : null}
								</Suspense>
							</ErrorBoundary>
						);
					}}
				</Match>
				<Match when={accessToken()}>
					<Navigate href="/overview" />
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
