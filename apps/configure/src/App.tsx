import { createAsync, useLocation, useNavigate } from "@solidjs/router";
import { ErrorBoundary, Match, Suspense, Switch } from "solid-js";
import { clearUsers, createQuery, syncUsers } from "./sync";
import {
	accessToken,
	generateOAuthUrl,
	logout,
	verifyCode as verifyOAuthCode,
} from "./util";

function App() {
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
					<AuthenticatedApp />
				</Match>
			</Switch>
		</div>
	);
}

function UnauthenticatedApp() {
	const loginUrl = createAsync(() => generateOAuthUrl());

	return (
		<Suspense>
			<a href={loginUrl()}>Login</a>
		</Suspense>
	);
}

function AuthenticatedApp() {
	const me = createAsync(async () => {
		const resp = await fetch("https://graph.microsoft.com/v1.0/me", {
			headers: {
				Authorization: accessToken()!,
			},
		});
		if (!resp.ok) throw new Error("Failed to fetch user info");

		return await resp.json();
	});

	// const mePhoto = createAsync(async () => {
	//   const resp = await fetch("https://graph.microsoft.com/v1.0/me/photo", {
	//     headers: {
	//       Authorization: accessToken()!,
	//     },
	//   });

	//   let body: any | undefined;

	//   try {
	//     if (resp.status === 404) {
	//       body = JSON.parse(await resp.json());
	//       console.log(body); // TODO
	//       if (body?.error?.code === "ImageNotFound") return null;
	//     }
	//   } catch (e) {}

	//   if (!resp.ok) throw new Error("Failed to get profile photo");

	//   if (!body) body = await resp.json();
	//   return body;
	// });

	// TODO: We need a UI state to handle the original sync w/ a progress bar
	// const [syncing, { refetch: resync }] = createResource(async () =>
	//   syncUsers()
	// );

	const users = createQuery("users");

	// TODO: Render before the sync is done but show indicator

	// TODO: Can we bind the UI directly to IndexedDB so changes across tabs sync???
	// TODO: Full-text search???

	return (
		<>
			<h1>Authenticated</h1>
			{/* TODO: Error boundary */}
			<Suspense fallback={<p>Loading...</p>}>
				<pre>{me()?.displayName}</pre>
				<pre>{me()?.userPrincipalName}</pre>
				{/* <pre>{JSON.stringify(mePhoto())}</pre> */}
			</Suspense>
			<div class="flex p-4 space-x-4">
				{/* <button type="button"  onClick={() => resync()} disabled={syncing.loading}>
          Sync
        </button> */}
				<button
					type="button"
					onClick={() => syncUsers().then(() => alert("done"))}
				>
					Sync
				</button>
				<button type="button" onClick={() => clearUsers()}>
					Reset users
				</button>
				<button type="button" onClick={() => logout()}>
					Logout
				</button>
			</div>
			{/* {syncing.loading ? <p>Syncing...</p> : null} */}
			<input type="search" placeholder="Search users..." />
			<ErrorBoundary fallback={null}>
				<Suspense fallback={<p>Loading...</p>}>
					{/* TODO: Render accountEnabled */}
					<pre>{JSON.stringify(users(), null, 2)}</pre>
				</Suspense>
			</ErrorBoundary>
		</>
	);
}

export default App;
