// @refresh reload
import { type EventBus, createEventBus } from "@solid-primitives/event-bus";
import { Router, useLocation, useNavigate } from "@solidjs/router";
// import { broadcastQueryClient } from "@tanstack/query-broadcast-client-experimental";
import {
	QueryCache,
	QueryClient,
	QueryClientProvider,
	keepPreviousData,
	onlineManager,
} from "@tanstack/solid-query";
import { Suspense, lazy, onCleanup, startTransition } from "solid-js";
import { Toaster, toast } from "solid-sonner";
import { FileRoutes } from "@solidjs/start/router";

import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { isTRPCClientError, trpc } from "./lib";

import "@mattrax/ui/css";
import "./assets/sonner.css";

// TODO: Maybe PR this back to Solid DND???
declare module "solid-js" {
	namespace JSX {
		interface Directives {
			sortable: true;
		}
	}
}

function createQueryClient(errorBus: EventBus<[string, unknown]>) {
	const onErrorFactory = (scopeMsg: string) => (error: unknown) => {
		errorBus.emit([scopeMsg, error]);
	};

	const queryClient = new QueryClient({
		queryCache: new QueryCache({
			onError: onErrorFactory("Error fetching data from server!"),
		}),
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: 1000 * 60 * 60 * 24, // 24 hours
				refetchInterval: 1000 * 60, // 1 minute
				placeholderData: keepPreviousData,
			},
			mutations: {
				onError: onErrorFactory("Error sending operation to the server!"),
			},
		},
	});

	// broadcastQueryClient({
	// 	queryClient,
	// 	broadcastChannel: "rq",
	// });

	// const persister = createSyncStoragePersister({
	//   // TODO: IndexedDB
	//   storage: window.localStorage,
	// });

	return [
		queryClient,
		// {
		//   persister,
		//   dehydrateOptions: {
		//     shouldDehydrateQuery: (q) => keysToPersist.includes(q.queryHash),
		//   },
		// } satisfies Omit<PersistQueryClientOptions, "queryClient">,
	] as const;
}

const SolidQueryDevtools = lazy(() =>
	import("@tanstack/solid-query-devtools").then((m) => ({
		default: m.SolidQueryDevtools,
	})),
);

export default function App() {
	const errorBus = createEventBus<[string, unknown]>();

	const [queryClient /* persistOptions */] = createQueryClient(errorBus);

	return (
		<QueryClientProvider client={queryClient}>
			<trpc.Provider queryClient={queryClient}>
				<Router
					root={(props) => {
						const navigate = useNavigate();
						const location = useLocation();

						onCleanup(
							errorBus.listen(([scopeMsg, error]) => {
								let errorMsg = (
									<>
										{scopeMsg},
										<br />
										Please reload to try again!
									</>
								);

								if (isTRPCClientError(error)) {
									if (error.data?.code === "UNAUTHORIZED") {
										startTransition(() => {
											let query = "";
											if (
												location.pathname !== "/" &&
												location.pathname !== "/login"
											)
												query = `?${new URLSearchParams({
													continueTo: location.pathname,
												})}`;

											navigate(`/login${query}`);
										});
										return;
										// biome-ignore lint/style/noUselessElse:
									} else if (error.data?.code === "FORBIDDEN") {
										if (error.message === "tenant") navigate("/");
										else
											errorMsg =
												"You are not allowed to access this resource!,";
									} else if (error.data?.code === "NOT_FOUND") {
										// not founds are handled at an app level with `.get` queries returning `null`
										return;
									}
								}

								toast.error(errorMsg, {
									id: "network-error",
								});
							}),
						);

						onCleanup(
							onlineManager.subscribe((isOnline) => {
								if (isOnline) {
									// TODO: This dismiss doesn't animate the toast close which is ugly.
									toast.dismiss("network-offline");
									return;
								}

								toast.error(
									<>
										You are offline!,
										<br />
										Please reconnect to continue!
									</>,
									{
										id: "network-offline",
										duration: Number.POSITIVE_INFINITY,
									},
								);
							}),
						);

						return (
							// <PersistQueryClientProvider
							//   client={queryClient}
							//   persistOptions={persistOptions}
							// >

							<>
								{import.meta.env.DEV && <SolidQueryDevtools />}
								<MErrorBoundary>
									<Toaster />
									<Suspense>{props.children}</Suspense>
								</MErrorBoundary>
							</>
							// </PersistQueryClientProvider>
						);
					}}
				>
					<FileRoutes />
				</Router>
			</trpc.Provider>
		</QueryClientProvider>
	);
}
