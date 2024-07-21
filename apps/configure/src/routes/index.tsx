import {
	Navigate,
	createAsync,
	useLocation,
	useNavigate,
} from "@solidjs/router";
import { ErrorBoundary, Match, Suspense, Switch } from "solid-js";
import { accessToken, generateOAuthUrl, verifyOAuthCode } from "../util/auth";

export default function Page() {
	const location = useLocation();
	const navigate = useNavigate();

	return (
		<div class="p-4">
			<Switch fallback={<UnauthenticatedApp />}>
				<Match when={location.query?.error !== undefined}>
					<p class="bg-red-500">
						{location.query?.error_description || location.query?.error}
					</p>
				</Match>
				<Match when={location.query?.code !== undefined} keyed>
					{(_) => {
						// TODO: Error handling for `verifyCode`
						const access_token = createAsync(async () => {
							await verifyOAuthCode(location.query.code);
							// Clear the query params
							navigate("/");
						});

						return (
							<ErrorBoundary
								fallback={
									<>
										<p>Error verifying access token! Please try again!</p>
										<a href="/">Try again...</a>
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
				<Match when={accessToken() !== null}>
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
			<a href={loginUrl()}>Login</a>
		</Suspense>
	);
}
