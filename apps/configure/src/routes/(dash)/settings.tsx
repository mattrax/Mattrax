import {
	Avatar,
	AvatarFallback,
	Badge,
	Button,
	Card,
	CardContent,
	CardTitle,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	Input,
	Progress,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
	Switch as USwitch,
	badgeVariants,
	buttonVariants,
} from "@mattrax/ui";
import { latest } from "@mattrax/ui/solid";
import { A, useLocation, useNavigate } from "@solidjs/router";
import { createMutation, createQuery } from "@tanstack/solid-query";
import clsx from "clsx";
import {
	For,
	Match,
	Show,
	Suspense,
	Switch,
	createEffect,
	createSignal,
	onCleanup,
	onMount,
} from "solid-js";
import { z } from "zod";
import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";
import {
	setShowKdbShortcuts,
	setSyncDisabled,
	showKdbShortcuts,
	syncDisabled,
} from "~/lib/config";
import { getKey } from "~/lib/kv";
import { createDbQuery } from "~/lib/query";
import { useSync } from "~/lib/sync";
import { useEphemeralAction } from "~/lib/sync/action";
import { createDomain, verifyDomain } from "~/lib/sync/actions/tenant";
import { resetSyncState } from "~/lib/sync/operation";
import { useZodParams } from "~/lib/useZodParams";
import { getInitials } from "../(dash)";

export default function Page() {
	const org = createDbQuery((db) => getKey(db, "org"));

	return (
		<PageLayout heading={<PageLayoutHeading>Settings</PageLayoutHeading>}>
			<Card>
				<div class="w-full flex justify-between items-center p-6 pb-0">
					<CardTitle class="h-5">Tenant</CardTitle>

					<a
						class={clsx(buttonVariants({ variant: "link" }), "!p-0")}
						classList={{
							"cursor-default select-none pointer-events-none": org.loading,
						}}
						href={`https://portal.azure.com/${latest(org)?.id}#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/Overview`}
						target="_blank"
						rel="noreferrer"
					>
						Microsoft Entra ID
						<IconPrimeExternalLink class="inline ml-1" />
					</a>
				</div>
				<CardContent>
					<dl class="divide-y divide-gray-100">
						<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
							<dt class="text-sm font-medium leading-6 text-gray-900">Name</dt>
							<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
								<Suspense>{org()?.name}</Suspense>
							</dd>
						</div>
						<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
							<dt class="text-sm font-medium leading-6 text-gray-900">
								License
							</dt>
							<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
								<Suspense>{org()?.plan}</Suspense>
							</dd>
						</div>
						<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
							<dt class="text-sm font-medium leading-6 text-gray-900">
								Identifier
							</dt>
							<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
								<pre>
									<Suspense>{org()?.id}</Suspense>
								</pre>
							</dd>
						</div>
						<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
							<dt class="text-sm font-medium leading-6 text-gray-900">
								Country or region
							</dt>
							<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
								<Suspense>
									{getCountryNameFromCode(org()?.countryLetterCode)}
								</Suspense>
							</dd>
						</div>
					</dl>
				</CardContent>
			</Card>

			<BillingPanel />
			{/* <SyncPanel /> */}
			<DomainsPanel />
			<MobilityPanel />
			<AdvancedPanel />
			<DangerZone />
		</PageLayout>
	);
}

const plans = {
	trial: {
		color: "bg-primary",
		devices: 10,
		cost: 0,
	},
	pro: {
		color: "bg-green-500",
		devices: 100,
		cost: 10,
	},
	enterprise: {
		color: "bg-orange-500",
		devices: 500,
		cost: 20,
	},
	custom: {
		color: "bg-red-500",
		devices: 99999999,
		cost: 30,
	},
};

function BillingPanel() {
	const devicesRaw = createDbQuery((db) => db.count("devices"));
	const devices = () => devicesRaw() ?? 0;

	const getPlan = () => {
		for (const [key, plan] of Object.entries(plans)) {
			if (devices() <= plan?.devices) return [key, plan] as const;
		}
		return undefined;
	};

	return (
		<Card>
			<div class="w-full flex justify-between items-center p-6 pb-0">
				<CardTitle class="h-5">Billing</CardTitle>
			</div>
			<CardContent>
				<dl class="divide-y divide-gray-100">
					<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
						<dt class="text-sm font-medium leading-6 text-gray-900">
							Active plan
						</dt>
						<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
							<span class="uppercase">
								<Suspense fallback="unknown">{getPlan()?.[0]}</Suspense>
							</span>
							<span class="opacity-75">
								{" "}
								- While in alpha billing is disabled!
							</span>
						</dd>
					</div>
					<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
						<dt class="text-sm font-medium leading-6 text-gray-900">
							Price (monthly)
						</dt>
						<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
							<Suspense fallback="">{getPlan()?.[1].cost}$</Suspense>
						</dd>
					</div>
					<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
						<Suspense>
							<dt class="text-sm font-medium leading-6 text-gray-900">Usage</dt>
							<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0 flex flex-col space-y-1">
								<h3 class="text-md font-bold tracking-tight">Devices:</h3>
								<Show
									when={getPlan()}
									keyed
									fallback={<p>Failed to find plan!</p>}
								>
									{([_, plan]) => (
										<Progress
											value={(devices() / plan.devices) * 100}
											color={
												devices() > Math.floor((plan.devices / 4) * 3)
													? "bg-orange-500"
													: undefined
											}
										/>
									)}
								</Show>
								<p class="text-muted-foreground text-sm">
									Your currently manage {devices()} devices out of the{" "}
									{getPlan()?.[1].devices} supported by your plan.
								</p>
							</dd>
						</Suspense>
					</div>
				</dl>
			</CardContent>
		</Card>
	);
}

function SyncPanel() {
	const sync = useSync();

	const abort = new AbortController();
	onCleanup(() => abort.abort());

	const fullResync = createMutation(() => ({
		mutationFn: async (data) => {
			await resetSyncState(sync.db);
			await sync.syncAll(abort);
		},
	}));

	// <div class="bg-slate-100 rounded-md w-full py-4 px-6 mt-2 flex justify-between items-center">
	// 	<div>
	// 		<h6 class="text-slate-700 text-md font-medium">Refresh database</h6>
	// 		<p class="text-slate-700 text-sm font-normal">
	// 			Completely refresh the local database with Microsoft!
	// 		</p>
	// 	</div>

	// 	<Button
	// 		disabled={fullResync.isPending}
	// 		onClick={() => fullResync.mutate()}
	// 	>
	// 		Resync
	// 	</Button>
	// </div>

	return (
		<Card>
			<div class="w-full flex justify-between p-6 pb-0">
				<CardTitle class="h-5">Sync</CardTitle>
			</div>
			<CardContent>
				{/* <div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
					<dt class="text-sm font-medium leading-6 text-gray-900">
						<h3>Show keyboard shortcuts</h3>
						<h4 class="text-xs text-muted-foreground">
							Show hints across the UI for keyboard shortcuts
						</h4>
					</dt>
					<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0"></dd>
				</div> */}

				{/* // TODO: Full-sync button + show sync errors */}
			</CardContent>
		</Card>
	);
}

function DomainsPanel() {
	const navigate = useNavigate();
	const org = createDbQuery((db) => getKey(db, "org"));
	const [newDomain, setNewDomain] = createSignal<string | undefined>();
	const create = useEphemeralAction(createDomain);

	return (
		<Card>
			<DomainVerificationModal />
			<div class="w-full flex justify-between items-center p-6 pb-0">
				<CardTitle class="h-5">Domains</CardTitle>
			</div>
			<CardContent>
				<dl class="divide-y divide-gray-100">
					<For
						each={latest(org)?.domains || []}
						fallback={
							<p class="text-muted-foreground text-sm w-full text-center py-4">
								No domains found!
							</p>
						}
					>
						{(domain) => {
							const count = createDbQuery((db) =>
								db.countFromIndex("users", "domain", domain.id),
							);

							return (
								<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
									<dt class="text-sm font-medium leading-6 text-gray-900 flex items-center">
										<a
											href={`https://${domain.id}`}
											target="_blank"
											rel="noreferrer"
											class="hover:underline"
										>
											{domain.id}
										</a>
									</dt>
									<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0 flex justify-between items-center">
										<div class="flex space-x-4">
											{/* // TODO: Add Tooltip to badge */}
											<Switch
												fallback={
													<>
														<Badge class="cursor-default">
															{domain.isDefault
																? "Primary"
																: domain.isInitial
																	? "Initial"
																	: "Verified"}
														</Badge>

														{/* // TODO: Turn this into a link to the search interface w/ the query prefilled */}
														<p class="text-muted-foreground">
															Used by{" "}
															<b>
																<Suspense fallback="...">{count()}</Suspense>
															</b>{" "}
															users
														</p>
													</>
												}
											>
												<Match when={!domain.isAdminManaged}>
													<a
														href={`https://portal.azure.com/${org()?.id}#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/Domains`}
														target="_blank"
														class={badgeVariants({})}
														rel="noreferrer"
													>
														Managed by Microsoft 365
													</a>
												</Match>
												<Match when={!domain.isVerified}>
													<A
														href={`domains/${encodeURIComponent(domain.id)}`}
														class={clsx(
															badgeVariants({ variant: "ghost" }),
															"bg-orange-400 text-amber-100",
														)}
														classList={{
															"cursor-default select-none": !org()?.id,
														}}
														rel="noreferrer"
													>
														Unverified
													</A>
												</Match>
											</Switch>
										</div>

										<Show
											when={
												domain.isInitial ||
												domain.isDefault ||
												(latest(count) ?? 0) > 0
											}
										>
											<Button
												variant="destructive"
												size="sm"
												onClick={() => alert("TODO")}
											>
												Delete
											</Button>
										</Show>
									</dd>
								</div>
							);
						}}
					</For>

					{/* // TODO: This should reuse the same component with the one above??? */}
					<Show when={newDomain() !== undefined}>
						<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
							<dt
								class="text-sm font-medium leading-6 text-gray-900 flex items-center"
								contentEditable
								ref={(ref) => onMount(() => ref.focus())}
								// onChange={(e) => {
								// 	console.log("CHANGE", e.currentTarget.textContent || "");
								// 	setNewDomain(e.currentTarget.textContent || "");
								// }}
								onKeyDown={(e) => {
									console.log(e.key, newDomain()); // TODO

									if (e.key === "Escape") setNewDomain(undefined);
									const domain = newDomain();
									if (e.key === "Enter" && domain !== undefined) {
										if (domain === "") {
											setNewDomain(undefined);
											return;
										}

										alert(1);

										// TODO: Input validation -> is it a domain?
										navigate(`domains/${encodeURIComponent(domain)}`);
										setNewDomain(undefined); // TODO: After the modal closes
									}
								}}
								onFocusOut={() => {
									// TODO: Warn if not empty it won't be saved
									setNewDomain(undefined);
								}}
							>
								{newDomain()}
							</dt>
						</div>
					</Show>

					<div class="w-full">
						<button
							type="button"
							class="text-muted-foreground my-2 text-sm hover:underline"
							onClick={() => setNewDomain("")}
						>
							Add new domain...
						</button>
					</div>
				</dl>
			</CardContent>
		</Card>
	);
}

function DomainVerificationModal() {
	const navigate = useNavigate();
	const params = useZodParams({
		domain: z
			.string()
			.transform((s) => decodeURIComponent(s))
			.optional(),
	});

	return (
		<Dialog
			open={!!params.domain}
			onOpenChange={(isOpen) => {
				if (!isOpen) navigate("../../");
			}}
		>
			<DialogContent>
				<Show when>
					{(_) => {
						// `DialogContent` is keyed so this signal will be recreated each time the modal is opened.
						// It holds the domain so that the modal content continues rendering between `params.domain` being set `undefined` and the modal close animation finishing.
						const [domain] = createSignal(params.domain!);
						return <DomainVerificationModalBody domain={domain()} />;
					}}
				</Show>
			</DialogContent>
		</Dialog>
	);
}

function DomainVerificationModalBody(props: { domain: string }) {
	const sync = useSync();
	const verify = useEphemeralAction(verifyDomain);
	const dnsVerification = createQuery(() => ({
		queryKey: ["domain", props.domain, "verification"],
		// TODO: Break this into a helper?
		queryFn: async () => {
			const accessToken = await getKey(sync.db, "accessToken");
			if (!accessToken) return null; // TODO: Redirect to login momentarily

			const resp = await fetch(
				`https://graph.microsoft.com/v1.0/domains/${encodeURIComponent(props.domain)}/verificationDnsRecords`,
				{
					headers: {
						Authorization: `Bearer ${accessToken}`,
					},
				},
			);
			if (!resp.ok)
				throw new Error(
					`Failed to fetch domain verification data. Got status ${resp.status}`,
				);

			// TODO: Zod validation
			const result = await resp.json();

			const txtRecord = result.value.find(
				(r: any) => r["@odata.type"] === "#microsoft.graph.domainDnsTxtRecord",
			);
			const mxRecord = result.value.find(
				(r: any) => r["@odata.type"] === "#microsoft.graph.domainDnsMxRecord",
			);

			return {
				txt: txtRecord
					? {
							Name: txtRecord.label,
							Target: txtRecord.text,
							TTL: txtRecord.ttl,
						}
					: undefined,
				mx: mxRecord
					? {
							Name: mxRecord.label,
							Target: mxRecord.mailExchange,
							TTL: mxRecord.ttl,
							Priority: mxRecord.preference,
						}
					: undefined,
			};
		},
	}));

	const [activeTab, setActiveTab] = createSignal<"txt" | "mx" | "fallback">(
		"fallback",
	);
	createEffect(() => {
		if (activeTab() === "fallback" && dnsVerification.data?.txt)
			setActiveTab("txt");
		if (activeTab() === "fallback" && dnsVerification.data?.mx)
			setActiveTab("mx");
	});

	return (
		<DialogHeader>
			<DialogTitle>Verify domain ownership</DialogTitle>
			<DialogDescription>
				<p class="py-2">
					You must verify <b>{props.domain}</b> before it can be used.
				</p>
				<Suspense
					fallback={
						<div class="h-[220px] flex justify-center items-center">
							<span class="text-xl">
								<IconSvgSpinners90Ring class="size-10 mt-4" />
							</span>
						</div>
					}
				>
					<Tabs value={activeTab()} onChange={setActiveTab}>
						<TabsList class="grid w-full grid-cols-2">
							<TabsTrigger value="fallback" class="hidden" aria-hidden />
							<TabsTrigger value="txt" disabled={!dnsVerification.data?.txt}>
								TXT
							</TabsTrigger>
							<TabsTrigger value="mx" disabled={!dnsVerification.data?.mx}>
								MX
							</TabsTrigger>
						</TabsList>

						<Switch
							fallback={
								<TabsContent value="fallback" class="" tabIndex="-1">
									<p class="text-center my-4">
										No supported verification methods where found!
									</p>
								</TabsContent>
							}
						>
							<Match when={activeTab() !== "fallback"}>
								<TabsContent
									value={activeTab()}
									class="divide-y divide-gray-100"
								>
									<For
										each={Object.entries(
											// @ts-expect-error// TODO: Fix
											dnsVerification.data?.[activeTab()] || {},
										)}
									>
										{([key, value]) => (
											<div class="py-3 sm:grid sm:grid-cols-3 sm:gap-4">
												<dt class="text-sm font-medium text-gray-900 flex items-center">
													{key}
												</dt>
												<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
													<Input
														value={value as string}
														readOnly
														class="cursor-default"
													/>
												</dd>
											</div>
										)}
									</For>

									<Button
										class="w-full"
										onClick={() => verify.mutate({ domain: props.domain })}
										disabled={verify.isPending}
									>
										<Show when={verify.isPending} fallback="Verify">
											<IconSvgSpinners90Ring class="size-8" />
										</Show>
									</Button>
								</TabsContent>
							</Match>
						</Switch>
					</Tabs>
				</Suspense>
			</DialogDescription>
		</DialogHeader>
	);
}

function MobilityPanel() {
	const apps = createDbQuery((db) => getKey(db, "orgMobility"));

	return (
		<Card>
			<div class="w-full flex justify-between p-6 pb-0">
				<CardTitle class="h-5">Mobility</CardTitle>
			</div>
			<CardContent>
				<For
					each={latest(apps) || []}
					fallback={
						<p class="text-muted-foreground text-sm w-full text-center">
							No mobility applications found!
						</p>
					}
				>
					{(app) => (
						<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
							<dt class="text-sm font-medium leading-6 text-gray-900 flex space-x-2 items-center">
								<Avatar class="!rounded-md">
									{/* // TODO: Get the logo from Intune */}
									{/* <AvatarImage class="!rounded-md" src="" /> */}
									<AvatarFallback class="!rounded-md">
										{getInitials(app.displayName)}
									</AvatarFallback>
								</Avatar>

								<div>
									<h3>{app.displayName}</h3>
									<h4 class="text-xs text-muted-foreground">
										{app.description || ""}
									</h4>
								</div>
							</dt>
							<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
								<Tabs
									value={app.appliesTo}
									defaultValue="none"
									class="flex"
									disabled
									// onChange={() => alert("todo")}
								>
									<TabsList class="max-w-[250px] grid w-full grid-cols-3">
										<TabsTrigger value="none">None</TabsTrigger>
										<TabsTrigger value="all">All</TabsTrigger>
										<TabsTrigger value="selected">Some</TabsTrigger>
									</TabsList>
									<TabsContent
										value="selected"
										class="ml-4 flex space-x-2 items-center"
									>
										<For each={app.includedGroups || []}>
											{(group) => (
												<A href={`../groups/${group.id}`}>
													<Badge
														variant="ghost"
														class="bg-muted hover:shadow !rounded-md"
													>
														{group.displayName}
													</Badge>
												</A>
											)}
										</For>
										<button
											type="button"
											class={clsx(
												badgeVariants({
													variant: "ghost",
												}),
												"bg-muted hover:shadow !rounded-md",
												"disabled:cursor-not-allowed",
											)}
											disabled
											// TODO: Add a group flow
											// onClick={() => alert("todo")}
										>
											<IconPhPlusCircle />
										</button>
									</TabsContent>
								</Tabs>
							</dd>
						</div>
					)}
				</For>
			</CardContent>
		</Card>
	);
}

function AdvancedPanel() {
	const location = useLocation();
	const isDev = () =>
		import.meta.env.MODE === "development" || location.query?.dev !== undefined;

	return (
		<Card>
			<div class="w-full flex justify-between p-6 pb-0">
				<CardTitle class="h-5">Advanced</CardTitle>
			</div>
			<CardContent>
				<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
					<dt class="text-sm font-medium leading-6 text-gray-900">
						<h3>Show keyboard shortcuts</h3>
						<h4 class="text-xs text-muted-foreground">
							Show hints across the UI for keyboard shortcuts
						</h4>
					</dt>
					<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
						<USwitch
							checked={showKdbShortcuts()}
							onChange={() => setShowKdbShortcuts((v) => !v)}
						/>
					</dd>
				</div>
				<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
					<dt class="text-sm font-medium leading-6 text-gray-900">
						<h3>MDM backend</h3>
						<h4 class="text-xs text-muted-foreground">
							Configure the source of truth for device management
						</h4>
					</dt>
					<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
						<Select
							value="Microsoft Intune"
							options={["Microsoft Intune", "Mattrax"]}
							disabled={true}
							itemComponent={(props) => (
								<SelectItem item={props.item}>{props.item.rawValue}</SelectItem>
							)}
						>
							<SelectTrigger aria-label="MDM Backend" class="max-w-[180px]">
								<SelectValue<string>>
									{(state) => state.selectedOption()}
								</SelectValue>
							</SelectTrigger>
							<SelectContent />
						</Select>
					</dd>
				</div>
				<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
					<dt class="text-sm font-medium leading-6 text-gray-900">
						<h3>Link with Git provider</h3>
						<h4 class="text-xs text-muted-foreground">
							Connect with a Git provider for version control
						</h4>
					</dt>
					<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
						<Button
							variant="ghost"
							disabled={true}
							onClick={() => alert("todo")}
						>
							<IconLogosGithubIcon />
						</Button>
					</dd>
				</div>
			</CardContent>

			<Show when={isDev()}>
				<div class="w-full flex justify-between px-6">
					<CardTitle class="h-5">Development</CardTitle>
				</div>
				<CardContent>
					<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
						<dt class="text-sm font-medium leading-6 text-gray-900">
							<h3>Disable sync</h3>
							<h4 class="text-xs text-muted-foreground">
								Show hints across the UI for keyboard shortcuts
							</h4>
						</dt>
						<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
							<USwitch
								checked={syncDisabled()}
								onChange={() => setSyncDisabled((v) => !v)}
							/>
						</dd>
					</div>
				</CardContent>
			</Show>
		</Card>
	);
}

function DangerZone() {
	const navigate = useNavigate();
	const sync = useSync();

	const deleteDb = createMutation(() => ({
		mutationFn: async (data) => {
			sync.db.close();
			await window.indexedDB.deleteDatabase(sync.db.name);
			navigate("/");
		},
	}));

	return (
		<section>
			<h2 class="text-lg font-semibold">Danger Zone</h2>

			<div class="bg-red-100 rounded-md w-full py-4 px-6 mt-2 flex justify-between items-center">
				<div>
					<h6 class="text-red-700 text-md font-medium">
						Delete the local database!
					</h6>
					<p class="text-red-700 text-sm font-normal">
						This action will permanently remove all local data and you will be
						logged out!
					</p>
				</div>

				{/* // TODO: Confirmation dialog */}
				<Button
					variant="destructive"
					disabled={deleteDb.isPending}
					onClick={() => deleteDb.mutate()}
				>
					Delete
				</Button>
			</div>
		</section>
	);
}

function getCountryNameFromCode(code: string | undefined) {
	if (!code) return null;
	try {
		return new Intl.DisplayNames(["en"], {
			type: "region",
		}).of(code);
	} catch (t) {
		return code;
	}
}
