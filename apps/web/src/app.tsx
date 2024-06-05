// @refresh reload
import { type EventBus, createEventBus } from "@solid-primitives/event-bus";
import { Router, useLocation, useNavigate } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import {
	QueryCache,
	QueryClient,
	QueryClientProvider,
	keepPreviousData,
	onlineManager,
} from "@tanstack/solid-query";
import { Suspense, lazy, onCleanup, startTransition } from "solid-js";
import { Toaster, toast } from "solid-sonner";

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
		console.error(scopeMsg, error);
		errorBus.emit([scopeMsg, error]);
	};

	return new QueryClient({
		queryCache: new QueryCache({
			onError: onErrorFactory("Error fetching data from server!"),
		}),
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: 1000 * 60 * 60 * 24, // 24 hours
				refetchInterval: 1000 * 60, // 1 minute
				staleTime: 1000 * 10, // 10 seconds
				refetchOnMount: (query) => query.isStale(),
				placeholderData: keepPreviousData,
			},
			mutations: {
				onError: onErrorFactory("Error sending operation to the server!"),
			},
		},
	});
}

const SolidQueryDevtools = lazy(() =>
	import("@tanstack/solid-query-devtools").then((m) => ({
		default: m.SolidQueryDevtools,
	})),
);

export default function App() {
	const errorBus = createEventBus<[string, unknown]>();

	const queryClient = createQueryClient(errorBus);

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
							<MErrorBoundary>
								{import.meta.env.DEV && <SolidQueryDevtools />}
								<Toaster />
								<Suspense>{props.children}</Suspense>
							</MErrorBoundary>
						);
					}}
				>
					<FileRoutes />
				</Router>
			</trpc.Provider>
		</QueryClientProvider>
	);
}
