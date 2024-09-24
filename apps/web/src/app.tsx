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
import {
	ErrorBoundary,
	Suspense,
	lazy,
	onCleanup,
	startTransition,
} from "solid-js";
import { Toaster, toast } from "solid-sonner";

import { isTRPCClientError, trpc, urlWithSearchParams } from "./lib";
import { parseJson } from "./lib/utils";

import "@mattrax/ui/css";

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
										{scopeMsg}
										<br />
										Please reload to try again!
									</>
								);

								if (isTRPCClientError(error)) {
									if (parseJson(error?.shape?.message)?.code) return;

									if (error.data?.code === "UNAUTHORIZED") {
										if (location.pathname.startsWith("/login")) return;

										const params = new URLSearchParams({
											...(location.pathname !== "/" &&
											!location.pathname.startsWith("/login")
												? { next: location.pathname }
												: {}),
										});

										startTransition(() =>
											navigate(urlWithSearchParams("/login", params), {
												state: {
													action: location.query?.action,
												},
												replace: true,
											}),
										);
										return;
									} else if (error.data?.code === "FORBIDDEN") {
										if (error.message === "tenant") navigate("/");
										errorMsg = `This ${error.message} does not exist or you are not allowed to access it!`;
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

						// TODO: Style this error boundary
						return (
							<ErrorBoundary
								fallback={(err) => {
									console.error(err);
									return null;
								}}
							>
								{import.meta.env.DEV && <SolidQueryDevtools />}
								<Toaster />
								<Suspense>{props.children}</Suspense>
							</ErrorBoundary>
						);
					}}
				>
					<FileRoutes />
				</Router>
			</trpc.Provider>
		</QueryClientProvider>
	);
}
