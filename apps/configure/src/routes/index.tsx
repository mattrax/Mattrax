import { buttonVariants } from "@mattrax/ui";
import { createAsync, useLocation, useNavigate } from "@solidjs/router";
import { openDB } from "idb";
import {
	ErrorBoundary,
	Match,
	Suspense,
	Switch,
	createResource,
} from "solid-js";
import { generateOAuthUrl, verifyOAuthCode } from "~/lib/auth";
import { listenForKvChanges } from "~/lib/query";

export default function Page() {
	const location = useLocation();
	const navigate = useNavigate();

	const [_, { refetch }] = createResource(async () => {
		const databases = await window.indexedDB.databases();
		for (const database of databases) {
			// How is this even possible
			if (!database.name || !database.version) continue;
			// We open using raw IndexedDB as we don't want to modify the schema.
			const db = await openDB(database.name, database.version);
			// This is probably not a Mattrax DB
			if (!db.objectStoreNames.contains("_kv")) continue;
			const accessToken = await db.get("_kv", "accessToken");
			// Cleanup
			db.close();
			// Check for authentication information
			if (accessToken !== undefined) navigate(`/${database.name}`);
		}
	});
	listenForKvChanges(() => refetch());

	return (
		<div class="p-4">
			<Switch fallback={<LandingPage />}>
				<Match when={location.query?.error !== undefined}>
					{/* // TODO: Properly style this flow */}
					<p class="bg-red-500">
						{location.query?.error_description || location.query?.error}
					</p>
					<a href="/" class={buttonVariants()}>
						Try again
					</a>
				</Match>
				<Match when={location.query?.code} keyed>
					{(code) => {
						const accessToken = createAsync(async () => {
							const userId = await verifyOAuthCode(code);
							navigate(`/${userId}`, { replace: true });
						});

						// TODO: Properly style this flow
						return (
							<ErrorBoundary
								fallback={
									<div class="flex flex-col space-y-2 max-w-sm">
										<h1 class="text-red-500 font-bold text-2xl">
											An error occurred
										</h1>
										<p class="text-red-500">
											Error verifying access token! Please try again!
										</p>
										<a href="/" class={buttonVariants()}>
											Try again
										</a>
									</div>
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

function LandingPage() {
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
