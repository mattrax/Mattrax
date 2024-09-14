import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import { Checkbox, Input } from "@mattrax/ui";
import { Navigate } from "@solidjs/router";
import { ErrorBoundary, For, Show, Suspense, createSignal } from "solid-js";

import { getObjectKeys } from "~/api/utils";
import { trpc } from "~/lib";
import { features } from "~/lib/featureFlags";

export default function Page() {
	const user = trpc.auth.me.createQuery();

	return (
		<div>
			<h1 class="text-2xl font-semibold">Features</h1>
			<p class="mt-2 mb-3 text-gray-700 text-sm">
				Enabled/disabled features that are not ready for prime time
			</p>
			<div class="flex flex-col gap-4">
				<Suspense>
					<Show when={user.data} keyed>
						{(activeUser) => {
							const [email, setEmail] = createSignal(activeUser.email);
							const getFeatures = trpc.auth.admin.getFeatures.createQuery(
								() => ({
									email: email(),
								}),
								() => ({
									enabled: email() !== activeUser.email,
									keepPreviousData: false,
								}),
							);

							const visibleFeatures = () =>
								// Show all features for superadmin, otherwise only show enabled features.
								activeUser.superadmin
									? getObjectKeys(features)
									: (activeUser.features ?? []);

							const enabledFeatures = () =>
								email() === activeUser.email
									? (activeUser.features ?? [])
									: (getFeatures.data ?? []);

							const enableFeature =
								trpc.auth.admin.enableFeature.createMutation(() => ({
									...withDependantQueries(
										email() === activeUser.email ? user : getFeatures,
									),
								}));

							return (
								<>
									{activeUser.superadmin && (
										<Input
											value={email()}
											onChange={(e) => setEmail(e.currentTarget.value)}
										/>
									)}
									<Suspense fallback={<p>Loading...</p>}>
										<ErrorBoundary fallback={(err) => <p>{err.message}</p>}>
											{activeUser?.superadmin !== true &&
												visibleFeatures().length === 0 && (
													<Navigate href=".." />
												)}
											<For each={visibleFeatures()}>
												{(feature) => (
													<div class="flex items-center space-x-2">
														<Checkbox
															checked={enabledFeatures().includes(feature)}
															onChange={(e) =>
																enableFeature.mutate({
																	feature,
																	email:
																		email() === activeUser.email
																			? undefined
																			: email(),
																})
															}
															disabled={enableFeature.isPending}
														/>
														<p>{features[feature]}</p>
													</div>
												)}
											</For>
										</ErrorBoundary>
									</Suspense>
								</>
							);
						}}
					</Show>
				</Suspense>
			</div>
		</div>
	);
}
