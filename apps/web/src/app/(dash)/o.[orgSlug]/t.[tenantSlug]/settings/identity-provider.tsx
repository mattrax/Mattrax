import {
	For,
	Match,
	Show,
	Suspense,
	Switch,
	createMemo,
	createSignal,
} from "solid-js";
import type { RouteDefinition } from "@solidjs/router";
import { toast } from "solid-sonner";
import { As } from "@kobalte/core";
import clsx from "clsx";
import {
	Badge,
	Button,
	Card,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogRoot,
	DialogTitle,
	DialogTrigger,
} from "@mattrax/ui";
import { withDependantQueries } from "@mattrax/trpc-server-function/client";

import IconMaterialSymbolsWarningRounded from "~icons/material-symbols/warning-rounded.jsx";
import IconIcOutlineClose from "~icons/ic/outline-close.jsx";
import IconPrimeExternalLink from "~icons/prime/external-link.jsx";
import { AUTH_PROVIDER_DISPLAY, authProviderUrl } from "~/lib/values";
import ENTRA_ID_ICON from "~/assets/EntraIDLogo.svg";
import { useTenantSlug } from "../../t.[tenantSlug]";
import { trpc } from "~/lib";
import { env } from "~/env";

export const route = {
	load: ({ params }) => {
		trpc.useContext().tenant.identityProvider.get.ensureData({
			tenantSlug: params.tenantSlug!,
		});
	},
} satisfies RouteDefinition;

export default function Page() {
	return (
		<div>
			<h1 class="text-2xl font-semibold">Identity Provider</h1>
			<p class="mt-2 mb-3 text-gray-700 text-sm">
				Sync user accounts and enroll devices by connecting an identity
				provider.
			</p>
			<Suspense>
				<IdentityProviderCard />
				<Domains />
			</Suspense>
		</div>
	);
}

function IdentityProviderCard() {
	const tenantSlug = useTenantSlug();

	const provider = trpc.tenant.identityProvider.get.createQuery(() => ({
		tenantSlug: tenantSlug(),
	}));

	const syncProvider = trpc.tenant.identityProvider.sync.createMutation(() => ({
		...withDependantQueries(provider),
	}));

	const removeProvider = trpc.tenant.identityProvider.remove.createMutation(
		() => ({
			...withDependantQueries(provider),
		}),
	);

	const gettingStarted = trpc.tenant.gettingStarted.createQuery(
		() => ({
			tenantSlug: tenantSlug(),
		}),
		() => ({
			enabled: false,
		}),
	);

	const [adminConsentPopupActive, setAdminConsentPopupActive] =
		createSignal(false);
	const linkEntra = trpc.tenant.identityProvider.linkEntraState.createMutation(
		() => ({
			onSuccess: (state) => {
				// This `setTimeout` causes Safari's popup blocker to not active.
				setTimeout(() => {
					const popupWindow = window.open(
						`${env.VITE_PROD_URL}/api/ms/popup?state=${state}`,
						"entraOAuth",
						"toolbar=no, menubar=no, width=600, height=700, top=100, left=100",
					);
					if (!popupWindow) {
						alert(
							"Failed to open admin consent dialog!\nPlease disable your pop-up blocker.",
						);
						return;
					}
					setAdminConsentPopupActive(true);

					// Detect the popup being closed manually
					const timer = setInterval(() => {
						setAdminConsentPopupActive(!popupWindow.closed);
						if (popupWindow.closed) clearInterval(timer);
					}, 500);

					// Handle `postMessage` from `/api/ms/link` oauth callback
					window.addEventListener("message", (e) => {
						if (e.source !== popupWindow || e.origin !== location.origin)
							return;

						popupWindow?.close();
						syncProvider.mutate({
							tenantSlug: tenantSlug(),
						});
						setAdminConsentPopupActive(false);
					});
				});
			},
			...withDependantQueries([provider, gettingStarted]),
		}),
	);

	return (
		<Card class="p-4 flex flex-row items-center">
			<Show
				when={provider.data}
				fallback={
					<Button
						variant="outline"
						class="space-x-2"
						onClick={() => linkEntra.mutate({ tenantSlug: tenantSlug() })}
						disabled={linkEntra.isPending || adminConsentPopupActive()}
					>
						<img src={ENTRA_ID_ICON} class="w-6" alt="Entra ID Logo" />
						<span>Entra ID</span>
					</Button>
				}
			>
				{(provider) => (
					<div class="flex justify-between w-full">
						<div class="flex flex-col text-sm gap-1 items-start">
							<a
								class="font-semibold hover:underline flex flex-row items-center gap-1"
								href={authProviderUrl(provider().provider, provider().remoteId)}
								target="_blank"
								rel="noreferrer"
							>
								{provider().name ?? AUTH_PROVIDER_DISPLAY[provider().provider]}
								<IconPrimeExternalLink class="inline" />
							</a>
							<span class="text-gray-600">{provider().remoteId}</span>

							<Show when={provider().linkerUpn}>
								{(upn) => <span class="text-gray-600">Linked by: {upn()}</span>}
							</Show>
						</div>
						<div class="flex space-x-4">
							<Button
								class="ml-auto"
								onClick={() =>
									toast.promise(
										syncProvider.mutateAsync({
											tenantSlug: tenantSlug(),
										}),
										{
											loading: "Syncing users...",
											success: "Completed user sync",
											error: "Failed to sync users",
										},
									)
								}
							>
								Sync
							</Button>
							<Button
								class="ml-auto"
								variant="destructive"
								onClick={() =>
									removeProvider.mutate({
										tenantSlug: tenantSlug(),
									})
								}
								disabled={removeProvider.isPending}
							>
								Remove
							</Button>
						</div>
					</div>
				)}
			</Show>
		</Card>
	);
}

function Domains() {
	const tenantSlug = useTenantSlug();
	const trpcCtx = trpc.useContext();

	const provider = trpc.tenant.identityProvider.get.createQuery(() => ({
		tenantSlug: tenantSlug(),
	}));

	const domains = trpc.tenant.identityProvider.domains.createQuery(() => ({
		tenantSlug: tenantSlug(),
	}));

	const refreshDomains =
		trpc.tenant.identityProvider.refreshDomains.createMutation(() => ({
			...withDependantQueries(domains),
		}));

	function allDomains() {
		const arr = [
			...new Set([
				...(domains.data?.remoteDomains ?? []),
				...(domains.data?.connectedDomains?.map((d) => d.domain) ?? []),
			]),
		];

		arr.sort((a, b) => {
			const aData = domains.data?.connectedDomains.find((d) => d.domain === a);
			const bData = domains.data?.connectedDomains.find((d) => d.domain === b);

			if (aData === bData) return 0;
			if (aData) return -1;
			if (bData) return 1;
			return 0;
		});

		return arr;
	}

	return (
		<>
			<div class="mt-4 flex flex-row">
				<div>
					<h2 class="text-lg font-semibold">Domains</h2>
					<p class="mt-1 mb-3 text-gray-700 text-sm">
						Connect domains to sync users and enroll devices.
					</p>
				</div>
				<Show when={provider.data}>
					<Button
						class="ml-auto"
						onClick={() => refreshDomains.mutate({ tenantSlug: tenantSlug() })}
						disabled={refreshDomains.isPending}
					>
						Refresh
					</Button>
				</Show>
			</div>
			<Show when={provider.data}>
				<Suspense>
					<Show when={allDomains().length > 0}>
						<ul class="rounded border border-gray-200 divide-y divide-gray-200">
							<For each={allDomains()}>
								{(domain) => {
									const connectionData = createMemo(() =>
										domains.data?.connectedDomains.find(
											(d) => d.domain === domain,
										),
									);

									const state = createMemo(() => {
										const data = connectionData();

										if (data) {
											if (!domains.data?.remoteDomains.includes(domain))
												return { variant: "dangling" } as const;

											return { variant: "connected", data } as const;
										}

										return { variant: "unconnected" };
									});

									return (
										<li class="p-4 flex flex-row gap-2 items-center">
											<div class="flex flex-col gap-1">
												<div class="font-medium flex flex-row items-center">
													{domain}
													<Show when={state().variant === "connected"}>
														<Badge class="ml-2">Connected</Badge>
													</Show>
													<Show when={state().variant !== "connected"}>
														<Badge class="ml-2" variant="outline">
															Unconnected
														</Badge>
													</Show>
												</div>
												<div class="flex flex-row items-center gap-1.5 mt-0.5">
													<Switch>
														<Match when={state().variant === "dangling"}>
															<div class="w-6 h-6">
																<IconMaterialSymbolsWarningRounded class="w-6 h-6 text-yellow-600" />
															</div>
															<span class="text-sm text-gray-600">
																Domain is no longer connected to the identity
																provider
															</span>
														</Match>
														<Match when={state().variant === "unconnected"}>
															<span class="text-sm text-gray-600">
																Domain found in identity provider
															</span>
														</Match>
														<Match
															when={(() => {
																const s = state();
																if (s.variant === "connected") return s.data;
															})()}
														>
															{(connectionData) => {
																const enterpriseEnrollment = () =>
																	connectionData()
																		.enterpriseEnrollmentAvailable;

																return (
																	<>
																		<div
																			class={clsx(
																				"w-5 h-5 rounded-full flex items-center justify-center text-white",
																				enterpriseEnrollment()
																					? "bg-green-600"
																					: "bg-red-600",
																			)}
																		>
																			{enterpriseEnrollment() ? (
																				<IconIcRoundCheck class="w-4 h-4" />
																			) : (
																				<IconIcOutlineClose class="w-4 h-4" />
																			)}
																		</div>
																		<span class="text-sm text-gray-600">
																			{enterpriseEnrollment() ? (
																				"Windows Automatic Enrollment configured"
																			) : (
																				<>
																					Windows Automatic Enrollment not
																					configured
																					<DialogRoot>
																						<DialogTrigger asChild>
																							<As
																								component={Button}
																								class="ml-2"
																								variant="outline"
																								size="iconSmall"
																							>
																								?
																							</As>
																						</DialogTrigger>
																						<DialogContent class="max-w-auto">
																							<DialogHeader>
																								<DialogTitle>
																									Windows Automatic Enrollment
																								</DialogTitle>
																								<DialogDescription>
																									To configure{" "}
																									<code>{domain}</code> for
																									Windows Automatic Enrollment,
																									add the following CNAME record
																									to it
																								</DialogDescription>
																							</DialogHeader>
																							<code>
																								{`CNAME enterpriseenrollment.${domain} mdm.mattrax.app`}
																							</code>
																						</DialogContent>
																					</DialogRoot>
																				</>
																			)}
																		</span>
																	</>
																);
															}}
														</Match>
													</Switch>
												</div>
											</div>
											<div class="flex-1" />
											<Switch>
												<Match when={state().variant !== "unconnected"}>
													{(_) => {
														const removeDomain =
															trpc.tenant.identityProvider.removeDomain.createMutation(
																() => ({
																	...withDependantQueries(domains),
																}),
															);

														return (
															<Button
																onClick={() =>
																	removeDomain.mutate({
																		tenantSlug: tenantSlug(),
																		domain,
																	})
																}
																disabled={removeDomain.isPending}
															>
																Disconnect
															</Button>
														);
													}}
												</Match>
												<Match when={state().variant === "unconnected"}>
													{(_) => {
														const enableDomain =
															trpc.tenant.identityProvider.connectDomain.createMutation(
																() => ({ ...withDependantQueries(domains) }),
															);

														return (
															<Button
																disabled={enableDomain.isPending}
																onClick={() =>
																	enableDomain.mutate({
																		tenantSlug: tenantSlug(),
																		domain,
																	})
																}
															>
																Connect
															</Button>
														);
													}}
												</Match>
											</Switch>
										</li>
									);
								}}
							</For>
						</ul>
					</Show>
				</Suspense>
			</Show>
		</>
	);
}
