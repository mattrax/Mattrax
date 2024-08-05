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
import { verifyOAuthCode } from "~/lib/auth";
import { getKey } from "~/lib/kv";
import { listenForKvChanges } from "~/lib/query";
import HomePage from "./home";

export default function Page() {
	const location = useLocation();
	const navigate = useNavigate();

	const [_, { refetch }] = createResource(async () => {
		for (const database of await window.indexedDB.databases()) {
			// How is this even possible
			if (!database.name || !database.version) continue;
			// We open using raw IndexedDB as we don't want to modify the schema.
			const db = await openDB(database.name, database.version);
			// This is probably not a Mattrax DB
			if (!db.objectStoreNames.contains("_kv")) continue;
			const accessToken = await getKey(db as any, "accessToken");
			// Cleanup
			db.close();
			// Check for authentication information
			if (accessToken !== undefined) navigate(`/${database.name}`);
		}
	});
	listenForKvChanges(() => refetch());

	return (
		<>
			<Switch fallback={<HomePage />}>
				<Match when={location.query?.error !== undefined}>
					<div class="p-4">
						{/* // TODO: Properly style this flow */}
						<p class="bg-red-500">
							{location.query?.error_description || location.query?.error}
						</p>
						<a href="/" class={buttonVariants()}>
							Try again
						</a>
					</div>
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
									<div class="flex flex-col space-y-2 max-w-sm p-4">
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
								<Suspense fallback={<p class="p-4">Verifying...</p>}>
									{accessToken() ? null : null}
								</Suspense>
							</ErrorBoundary>
						);
					}}
				</Match>
			</Switch>
		</>
	);
}
