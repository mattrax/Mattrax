import { BreadcrumbItem } from "@mattrax/ui";
import { Page } from "~/components/Page";

export default function () {
	return (
		<Page
			title="Settings"
			breadcrumbs={[<BreadcrumbItem>Settings</BreadcrumbItem>]}
		>
			TODO
		</Page>
	);
}

// export default function () {
// 	return <div class="flex-1 lg:max-w-2xl">
// 		<div class="space-y-6"><div><h3 class="text-lg font-medium">Profile</h3>
// 		<p class="text-sm text-muted-foreground">This is how others will see you on the site.</p></div>
// 		<div data-orientation="horizontal" role="none" class="shrink-0 bg-border h-[1px] w-full"></div>
// 		<form class="space-y-8"><div class="space-y-2"><label class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" for=":r5p:-form-item">Username</label>
// 		<input class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" placeholder="shadcn" id=":r5p:-form-item" aria-describedby=":r5p:-form-item-description" aria-invalid="false" name="username"><p id=":r5p:-form-item-description" class="text-[0.8rem] text-muted-foreground">This is your public display name. It can be your real name or a pseudonym. You can only change this once every 30 days.</p></div>
// 		<div class="space-y-2"><label class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" for=":r5q:-form-item">Email</label><button type="button" role="combobox" aria-controls="radix-:r5r:" aria-expanded="false" aria-autocomplete="none" dir="ltr" data-state="closed" data-placeholder="" class="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&amp;>span]:line-clamp-1" id=":r5q:-form-item" aria-describedby=":r5q:-form-item-description" aria-invalid="false"><span style="pointer-events: none;">Select a verified email to display</span>
// 		{/* <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 opacity-50" aria-hidden="true"><path d="M4.93179 5.43179C4.75605 5.60753 4.75605 5.89245 4.93179 6.06819C5.10753 6.24392 5.39245 6.24392 5.56819 6.06819L7.49999 4.13638L9.43179 6.06819C9.60753 6.24392 9.89245 6.24392 10.0682 6.06819C10.2439 5.89245 10.2439 5.60753 10.0682 5.43179L7.81819 3.18179C7.73379 3.0974 7.61933 3.04999 7.49999 3.04999C7.38064 3.04999 7.26618 3.0974 7.18179 3.18179L4.93179 5.43179ZM10.0682 9.56819C10.2439 9.39245 10.2439 9.10753 10.0682 8.93179C9.89245 8.75606 9.60753 8.75606 9.43179 8.93179L7.49999 10.8636L5.56819 8.93179C5.39245 8.75606 5.10753 8.75606 4.93179 8.93179C4.75605 9.10753 4.75605 9.39245 4.93179 9.56819L7.18179 11.8182C7.35753 11.9939 7.64245 11.9939 7.81819 11.8182L10.0682 9.56819Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path></svg> */}
// 		</button><select aria-hidden="true" tabindex="-1" style="position: absolute; border: 0px; width: 1px; height: 1px; padding: 0px; margin: -1px; overflow: hidden; clip: rect(0px, 0px, 0px, 0px); white-space: nowrap; overflow-wrap: normal;">
// 			<option value=""></option><option value="m@example.com">m@example.com</option><option value="m@google.com">m@google.com</option><option value="m@support.com">m@support.com</option></select><p id=":r5q:-form-item-description" class="text-[0.8rem] text-muted-foreground">You can manage verified email addresses in your <a href="/examples/forms">email settings</a>.</p></div><div class="space-y-2"><label class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" for=":r5s:-form-item">Bio</label><textarea class="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none" placeholder="Tell us a little bit about yourself" name="bio" id=":r5s:-form-item" aria-describedby=":r5s:-form-item-description" aria-invalid="false">I own a computer.</textarea><p id=":r5s:-form-item-description" class="text-[0.8rem] text-muted-foreground">You can <span>@mention</span> other users and organizations to link to them.</p></div><div /><div class="space-y-2" /><label class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" for=":r5t:-form-item">URLs</label><p id=":r5t:-form-item-description" class="text-[0.8rem] text-muted-foreground">Add links to your website, blog, or social media profiles.</p><input class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" id=":r5t:-form-item" aria-describedby=":r5t:-form-item-description" aria-invalid="false" value="https://shadcn.com" name="urls.0.value"></div><div class="space-y-2"><label class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 sr-only" for=":r5u:-form-item">URLs</label><p id=":r5u:-form-item-description" class="text-[0.8rem] text-muted-foreground sr-only">Add links to your website, blog, or social media profiles.</p><input class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" id=":r5u:-form-item" aria-describedby=":r5u:-form-item-description" aria-invalid="false" value="http://twitter.com/shadcn" name="urls.1.value"></div><button class="inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-8 rounded-md px-3 text-xs mt-2" type="button">Add URL</button></div><button class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2" type="submit">Update profile</button></form></div></div>
// }

// import {
// 	Avatar,
// 	AvatarFallback,
// 	Badge,
// 	Button,
// 	Card,
// 	CardContent,
// 	CardTitle,
// 	Dialog,
// 	DialogContent,
// 	DialogDescription,
// 	DialogHeader,
// 	DialogTitle,
// 	DoubleClickButton,
// 	Input,
// 	Progress,
// 	Select,
// 	SelectContent,
// 	SelectItem,
// 	SelectTrigger,
// 	SelectValue,
// 	Tabs,
// 	TabsContent,
// 	TabsList,
// 	TabsTrigger,
// 	Tooltip,
// 	TooltipContent,
// 	TooltipTrigger,
// 	Switch as USwitch,
// 	badgeVariants,
// 	buttonVariants,
// } from "@mattrax/ui";
// import { latest } from "@mattrax/ui/solid";
// import { A, useLocation, useNavigate } from "@solidjs/router";
// import { createMutation, createQuery } from "@tanstack/solid-query";
// import clsx from "clsx";
// import {
// 	For,
// 	Match,
// 	Show,
// 	Suspense,
// 	Switch,
// 	createEffect,
// 	createMemo,
// 	createSignal,
// 	onCleanup,
// 	onMount,
// } from "solid-js";
// import { toast } from "solid-sonner";
// import { z } from "zod";
// import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";
// import {
// 	setShowKdbShortcuts,
// 	setSyncDisabled,
// 	showKdbShortcuts,
// 	syncDisabled,
// } from "~/lib/config";
// import { getKey } from "~/lib/kv";
// import { createDbQuery } from "~/lib/query";
// import { useSync } from "~/lib/sync";
// import { useEphemeralAction } from "~/lib/sync/action";
// import {
// 	createDomain,
// 	deleteDomain,
// 	verifyDomain,
// } from "~/lib/sync/actions/tenant";
// import { resetSyncState } from "~/lib/sync/operation";
// import { useZodParams } from "~/lib/useZodParams";
// import { getInitials } from "../(dash)";

// const domainRegex =
// 	/^(((?!-))(xn--|_)?[a-z0-9-]{0,61}[a-z0-9]{1,1}\.)*(xn--)?([a-z0-9][a-z0-9\-]{0,60}|[a-z0-9-]{1,30}\.[a-z]{2,})$/;
// const zDomain = z
// 	.string()
// 	.refine((v) => v.includes(".") && domainRegex.test(v), {
// 		message: (
// 			<>
// 				Please enter a valid domain name. For example{" "}
// 				<span class="text-sm font-semibold text-red-600">example.com</span>
// 			</>
// 		) as string,
// 	});

// export default function Page() {
// 	const org = createDbQuery((db) => getKey(db, "org"));

// 	return (
// 		<PageLayout heading={<PageLayoutHeading>Settings</PageLayoutHeading>}>
// 			<Card>
// 				<div class="w-full flex justify-between items-center p-6 pb-0">
// 					<CardTitle class="h-5">Tenant</CardTitle>

// 					<a
// 						class={clsx(buttonVariants({ variant: "link" }), "!p-0")}
// 						classList={{
// 							"cursor-default select-none pointer-events-none": org.loading,
// 						}}
// 						href={`https://portal.azure.com/${latest(org)?.id}#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/Overview`}
// 						target="_blank"
// 						rel="noreferrer"
// 					>
// 						Microsoft Entra ID
// 						<IconPrimeExternalLink class="inline ml-1" />
// 					</a>
// 				</div>
// 				<CardContent>
// 					<dl class="divide-y divide-gray-100">
// 						<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
// 							<dt class="text-sm font-medium leading-6 text-gray-900">Name</dt>
// 							<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
// 								<Suspense>{org()?.name}</Suspense>
// 							</dd>
// 						</div>
// 						<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
// 							<dt class="text-sm font-medium leading-6 text-gray-900">
// 								License
// 							</dt>
// 							<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
// 								<Suspense>{org()?.plan}</Suspense>
// 							</dd>
// 						</div>
// 						<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
// 							<dt class="text-sm font-medium leading-6 text-gray-900">
// 								Identifier
// 							</dt>
// 							<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
// 								<pre>
// 									<Suspense>{org()?.id}</Suspense>
// 								</pre>
// 							</dd>
// 						</div>
// 						<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
// 							<dt class="text-sm font-medium leading-6 text-gray-900">
// 								Country or region
// 							</dt>
// 							<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
// 								<Suspense>
// 									{getCountryNameFromCode(org()?.countryLetterCode)}
// 								</Suspense>
// 							</dd>
// 						</div>
// 					</dl>
// 				</CardContent>
// 			</Card>

// 			<BillingPanel />
// 			{/* <SyncPanel /> */}
// 			<DomainsPanel />
// 			<MobilityPanel />
// 			<AdvancedPanel />
// 			<DangerZone />
// 		</PageLayout>
// 	);
// }

// const plans = {
// 	trial: {
// 		color: "bg-primary",
// 		devices: 10,
// 		cost: 0,
// 	},
// 	pro: {
// 		color: "bg-green-500",
// 		devices: 100,
// 		cost: 10,
// 	},
// 	enterprise: {
// 		color: "bg-orange-500",
// 		devices: 500,
// 		cost: 20,
// 	},
// 	custom: {
// 		color: "bg-red-500",
// 		devices: 99999999,
// 		cost: 30,
// 	},
// };

// function BillingPanel() {
// 	const devicesRaw = createDbQuery((db) => db.count("devices"));
// 	const devices = () => devicesRaw() ?? 0;

// 	const getPlan = () => {
// 		for (const [key, plan] of Object.entries(plans)) {
// 			if (devices() <= plan?.devices) return [key, plan] as const;
// 		}
// 		return undefined;
// 	};

// 	return (
// 		<Card>
// 			<div class="w-full flex justify-between items-center p-6 pb-0">
// 				<CardTitle class="h-5">Billing</CardTitle>
// 			</div>
// 			<CardContent>
// 				<dl class="divide-y divide-gray-100">
// 					<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
// 						<dt class="text-sm font-medium leading-6 text-gray-900">
// 							Active plan
// 						</dt>
// 						<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
// 							<span class="uppercase">
// 								<Suspense fallback="unknown">{getPlan()?.[0]}</Suspense>
// 							</span>
// 							<span class="opacity-75">
// 								{" "}
// 								- While in alpha billing is disabled!
// 							</span>
// 						</dd>
// 					</div>
// 					<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
// 						<dt class="text-sm font-medium leading-6 text-gray-900">
// 							Price (monthly)
// 						</dt>
// 						<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
// 							<Suspense fallback="">{getPlan()?.[1].cost}$</Suspense>
// 						</dd>
// 					</div>
// 					<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
// 						<Suspense>
// 							<dt class="text-sm font-medium leading-6 text-gray-900">Usage</dt>
// 							<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0 flex flex-col space-y-1">
// 								<h3 class="text-md font-bold tracking-tight">Devices:</h3>
// 								<Show
// 									when={getPlan()}
// 									keyed
// 									fallback={<p>Failed to find plan!</p>}
// 								>
// 									{([_, plan]) => (
// 										<Progress
// 											value={(devices() / plan.devices) * 100}
// 											color={
// 												devices() > Math.floor((plan.devices / 4) * 3)
// 													? "bg-orange-500"
// 													: undefined
// 											}
// 										/>
// 									)}
// 								</Show>
// 								<p class="text-muted-foreground text-sm">
// 									Your currently manage {devices()} devices out of the{" "}
// 									{getPlan()?.[1].devices} supported by your plan.
// 								</p>
// 							</dd>
// 						</Suspense>
// 					</div>
// 				</dl>
// 			</CardContent>
// 		</Card>
// 	);
// }

// function SyncPanel() {
// 	const sync = useSync();

// 	const abort = new AbortController();
// 	onCleanup(() => abort.abort());

// 	const fullResync = createMutation(() => ({
// 		mutationFn: async (data) => {
// 			await resetSyncState(sync.db);
// 			await sync.syncAll(abort);
// 		},
// 	}));

// 	// <div class="bg-slate-100 rounded-md w-full py-4 px-6 mt-2 flex justify-between items-center">
// 	// 	<div>
// 	// 		<h6 class="text-slate-700 text-md font-medium">Refresh database</h6>
// 	// 		<p class="text-slate-700 text-sm font-normal">
// 	// 			Completely refresh the local database with Microsoft!
// 	// 		</p>
// 	// 	</div>

// 	// 	<Button
// 	// 		disabled={fullResync.isPending}
// 	// 		onClick={() => fullResync.mutate()}
// 	// 	>
// 	// 		Resync
// 	// 	</Button>
// 	// </div>

// 	return (
// 		<Card>
// 			<div class="w-full flex justify-between p-6 pb-0">
// 				<CardTitle class="h-5">Sync</CardTitle>
// 			</div>
// 			<CardContent>
// 				{/* <div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
// 					<dt class="text-sm font-medium leading-6 text-gray-900">
// 						<h3>Show keyboard shortcuts</h3>
// 						<h4 class="text-xs text-muted-foreground">
// 							Show hints across the UI for keyboard shortcuts
// 						</h4>
// 					</dt>
// 					<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0"></dd>
// 				</div> */}

// 				{/* // TODO: Full-sync button + show sync errors */}
// 			</CardContent>
// 		</Card>
// 	);
// }

// function DomainsPanel() {
// 	const org = createDbQuery((db) => getKey(db, "org"));
// 	const remove = useEphemeralAction(deleteDomain, () => ({
// 		onError(err) {
// 			toast.error("Failed to delete domain!", {
// 				id: "delete-domain",
// 				description: err.message,
// 			});
// 		},
// 	}));

// 	return (
// 		<Card>
// 			<DomainVerificationModal />
// 			<div class="w-full flex justify-between items-center p-6 pb-0">
// 				<CardTitle class="h-5">Domains</CardTitle>
// 			</div>
// 			<CardContent>
// 				<dl class="divide-y divide-gray-100">
// 					<For
// 						each={latest(org)?.domains || []}
// 						fallback={
// 							<p class="text-muted-foreground text-sm w-full text-center py-4">
// 								No domains found!
// 							</p>
// 						}
// 					>
// 						{(domain) => {
// 							const count = createDbQuery((db) =>
// 								db.countFromIndex("users", "domain", domain.id),
// 							);

// 							return (
// 								<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
// 									<dt class="text-sm font-medium leading-6 text-gray-900 flex items-center">
// 										<a
// 											href={`https://${domain.id}`}
// 											target="_blank"
// 											rel="noreferrer"
// 											class="hover:underline"
// 										>
// 											{domain.id}
// 										</a>
// 									</dt>
// 									<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0 flex justify-between items-center">
// 										<div class="flex space-x-4">
// 											<Switch
// 												fallback={
// 													<>
// 														<Badge class="cursor-default w-[64px] flex justify-center">
// 															{domain.isDefault
// 																? "Primary"
// 																: domain.isInitial
// 																	? "Initial"
// 																	: "Verified"}
// 														</Badge>

// 														{/* // TODO: Turn this into a link to the search interface w/ the query prefilled */}
// 														<p class="text-muted-foreground">
// 															Used by{" "}
// 															<b>
// 																<Suspense fallback="...">{count()}</Suspense>
// 															</b>{" "}
// 															users
// 														</p>
// 													</>
// 												}
// 											>
// 												<Match when={!domain.isAdminManaged}>
// 													<a
// 														href={`https://portal.azure.com/${org()?.id}#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/Domains`}
// 														target="_blank"
// 														class={badgeVariants({})}
// 														rel="noreferrer"
// 													>
// 														Managed by Microsoft 365
// 													</a>
// 												</Match>
// 												<Match when={!domain.isVerified}>
// 													<Tooltip>
// 														<TooltipTrigger
// 															as={A}
// 															href={`domains/${encodeURIComponent(domain.id)}`}
// 															class={clsx(
// 																badgeVariants({ variant: "ghost" }),
// 																"bg-orange-400 text-amber-100 hover:shadow-xl hover:bg-orange-300",
// 															)}
// 															classList={{
// 																"cursor-default select-none": !org()?.id,
// 															}}
// 															rel="noreferrer"
// 														>
// 															Unverified
// 														</TooltipTrigger>
// 														<TooltipContent>
// 															Click here to verify this domain for use.
// 														</TooltipContent>
// 													</Tooltip>
// 												</Match>
// 											</Switch>
// 										</div>

// 										<Show
// 											when={
// 												!domain.isInitial &&
// 												!domain.isDefault &&
// 												(latest(count) ?? 0) === 0
// 											}
// 										>
// 											<DoubleClickButton
// 												variant="destructive"
// 												size="sm"
// 												onClick={() => remove.mutate({ domain: domain.id })}
// 												disabled={remove.isPending}
// 											>
// 												{(c) => (c ? "Confirm" : "Delete")}
// 											</DoubleClickButton>
// 										</Show>
// 									</dd>
// 								</div>
// 							);
// 						}}
// 					</For>

// 					<CreateDomain />
// 				</dl>
// 			</CardContent>
// 		</Card>
// 	);
// }

// function CreateDomain() {
// 	const navigate = useNavigate();
// 	const [newDomain, setNewDomain] = createSignal<string | undefined>();
// 	const create = useEphemeralAction(createDomain, () => ({
// 		onSuccess(_, { domain }) {
// 			navigate(`domains/${encodeURIComponent(domain)}`);
// 		},
// 		onError(err) {
// 			toast.error("Failed to create domain!", {
// 				id: "create-domain",
// 				description: err.message,
// 			});
// 		},
// 		onSettled() {
// 			setNewDomain(undefined);
// 		},
// 	}));

// 	let ref!: HTMLParagraphElement;

// 	const validationError = createMemo(() => {
// 		const d = newDomain();
// 		if (!d) return;
// 		return zDomain.safeParse(d).error?.errors?.[0]?.message;
// 	});

// 	// TODO: Warn if adding domain that is already managed

// 	const submit = () => {
// 		if (create.isPending) return;

// 		const domain = newDomain();
// 		if (domain === undefined) return;
// 		if (domain === "") {
// 			setNewDomain(undefined);
// 			return;
// 		}
// 		if (validationError()) {
// 			if (!ref.classList.contains("animate-shake")) {
// 				ref.classList.add("animate-shake");
// 				setTimeout(() => ref.classList.remove("animate-shake"), 500);
// 			}
// 			return;
// 		}

// 		create.mutate({
// 			domain,
// 		});
// 	};

// 	return (
// 		<>
// 			<Show when={newDomain() !== undefined}>
// 				<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
// 					<dt class="text-sm font-medium leading-6 text-gray-900 flex items-center flex justify-between">
// 						<p
// 							class="flex-1"
// 							contentEditable={!create.isPending}
// 							ref={(r) => {
// 								onMount(() => ref.focus());
// 								ref = r;
// 							}}
// 							onInput={(e) => setNewDomain(e.currentTarget.textContent || "")}
// 							onKeyDown={(e) => {
// 								if (e.key === "Escape") setNewDomain(undefined);
// 								if (e.key === "Enter") {
// 									// Prevent actually adding newlines
// 									e.preventDefault();
// 									submit();
// 								}
// 							}}
// 							onFocusOut={(e) => {
// 								// TODO: I'm not sure if this is *good* for accessibility
// 								// TODO: but if we don't do this we need a good way to warn about unsaved changes
// 								// TODO: or to just wipe out the changes and idk how I feel about either of them.
// 								e.currentTarget.focus();
// 							}}
// 						/>
// 						<Show when={!create.isPending} fallback={<IconSvgSpinners90Ring />}>
// 							<div class="flex space-x-1 pl-1">
// 								<button
// 									type="button"
// 									class="hover:text-slate-500"
// 									onClick={() => submit()}
// 								>
// 									<IconIcRoundCheck />
// 								</button>
// 								<button
// 									type="button"
// 									class="hover:text-slate-500"
// 									onClick={() => setNewDomain(undefined)}
// 								>
// 									<IconPhX />
// 								</button>
// 							</div>
// 						</Show>
// 					</dt>
// 					<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0 flex justify-between items-center">
// 						<Show when={validationError()}>
// 							{(error) => (
// 								<p class="mt-1 text-sm leading-6 text-red-600 sm:col-span-2 sm:mt-0">
// 									{error()}
// 								</p>
// 							)}
// 						</Show>
// 					</dd>
// 				</div>
// 			</Show>

// 			<div class="w-full">
// 				<button
// 					type="button"
// 					class="text-muted-foreground my-2 text-sm hover:underline"
// 					onClick={() => setNewDomain("")}
// 					disabled={newDomain() !== undefined}
// 				>
// 					Add new domain...
// 				</button>
// 			</div>
// 		</>
// 	);
// }

// function DomainVerificationModal() {
// 	const navigate = useNavigate();
// 	const params = useZodParams({
// 		domain: z
// 			.string()
// 			.transform((s) => decodeURIComponent(s))
// 			.optional(),
// 	});

// 	return (
// 		<Dialog
// 			open={!!params.domain}
// 			onOpenChange={(isOpen) => {
// 				if (!isOpen) navigate("../../");
// 			}}
// 		>
// 			<DialogContent>
// 				<Show when>
// 					{(_) => {
// 						// `DialogContent` is keyed so this signal will be recreated each time the modal is opened.
// 						// It holds the domain so that the modal content continues rendering between `params.domain` being set `undefined` and the modal close animation finishing.
// 						const [domain] = createSignal(params.domain!);
// 						return <DomainVerificationModalBody domain={domain()} />;
// 					}}
// 				</Show>
// 			</DialogContent>
// 		</Dialog>
// 	);
// }

// function DomainVerificationModalBody(props: { domain: string }) {
// 	const sync = useSync();
// 	const verify = useEphemeralAction(verifyDomain);
// 	const dnsVerification = createQuery(() => ({
// 		queryKey: ["domain", props.domain, "verification"],
// 		// TODO: Break this into a helper?
// 		queryFn: async () => {
// 			const accessToken = await getKey(sync.db, "accessToken");
// 			if (!accessToken) return null; // TODO: Redirect to login momentarily

// 			const resp = await fetch(
// 				`https://graph.microsoft.com/v1.0/domains/${encodeURIComponent(props.domain)}/verificationDnsRecords`,
// 				{
// 					headers: {
// 						Authorization: `Bearer ${accessToken}`,
// 					},
// 				},
// 			);
// 			if (!resp.ok)
// 				throw new Error(
// 					`Failed to fetch domain verification data. Got status ${resp.status}`,
// 				);

// 			// TODO: Zod validation
// 			const result = await resp.json();

// 			const txtRecord = result.value.find(
// 				(r: any) => r["@odata.type"] === "#microsoft.graph.domainDnsTxtRecord",
// 			);
// 			const mxRecord = result.value.find(
// 				(r: any) => r["@odata.type"] === "#microsoft.graph.domainDnsMxRecord",
// 			);

// 			return {
// 				txt: txtRecord
// 					? {
// 							Name: txtRecord.label,
// 							Target: txtRecord.text,
// 							TTL: txtRecord.ttl,
// 						}
// 					: undefined,
// 				mx: mxRecord
// 					? {
// 							Name: mxRecord.label,
// 							Target: mxRecord.mailExchange,
// 							TTL: mxRecord.ttl,
// 							Priority: mxRecord.preference,
// 						}
// 					: undefined,
// 			};
// 		},
// 	}));

// 	const [activeTab, setActiveTab] = createSignal<"txt" | "mx" | "fallback">(
// 		"fallback",
// 	);
// 	createEffect(() => {
// 		if (activeTab() === "fallback" && dnsVerification.data?.txt)
// 			setActiveTab("txt");
// 		if (activeTab() === "fallback" && dnsVerification.data?.mx)
// 			setActiveTab("mx");
// 	});

// 	return (
// 		<DialogHeader>
// 			<DialogTitle>Verify domain ownership</DialogTitle>
// 			<DialogDescription>
// 				<p class="py-2">
// 					You must verify <b>{props.domain}</b> before it can be used.
// 				</p>
// 				<Suspense
// 					fallback={
// 						<div class="h-[220px] flex justify-center items-center">
// 							<span class="text-xl">
// 								<IconSvgSpinners90Ring class="size-10 mt-4" />
// 							</span>
// 						</div>
// 					}
// 				>
// 					<Tabs value={activeTab()} onChange={setActiveTab}>
// 						<TabsList class="grid w-full grid-cols-2">
// 							<TabsTrigger value="fallback" class="hidden" aria-hidden />
// 							<TabsTrigger value="txt" disabled={!dnsVerification.data?.txt}>
// 								TXT
// 							</TabsTrigger>
// 							<TabsTrigger value="mx" disabled={!dnsVerification.data?.mx}>
// 								MX
// 							</TabsTrigger>
// 						</TabsList>

// 						<Switch
// 							fallback={
// 								<TabsContent value="fallback" class="" tabIndex="-1">
// 									<p class="text-center my-4">
// 										No supported verification methods where found!
// 									</p>
// 								</TabsContent>
// 							}
// 						>
// 							<Match when={activeTab() !== "fallback"}>
// 								<TabsContent
// 									value={activeTab()}
// 									class="divide-y divide-gray-100"
// 								>
// 									<For
// 										each={Object.entries(
// 											// @ts-expect-error// TODO: Fix
// 											dnsVerification.data?.[activeTab()] || {},
// 										)}
// 									>
// 										{([key, value]) => (
// 											<div class="py-3 sm:grid sm:grid-cols-3 sm:gap-4">
// 												<dt class="text-sm font-medium text-gray-900 flex items-center">
// 													{key}
// 												</dt>
// 												<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
// 													<Input
// 														value={value as string}
// 														readOnly
// 														class="cursor-default"
// 													/>
// 												</dd>
// 											</div>
// 										)}
// 									</For>

// 									<Button
// 										class="w-full"
// 										onClick={() => verify.mutate({ domain: props.domain })}
// 										disabled={verify.isPending}
// 									>
// 										<Show when={verify.isPending} fallback="Verify">
// 											<IconSvgSpinners90Ring class="size-8" />
// 										</Show>
// 									</Button>
// 								</TabsContent>
// 							</Match>
// 						</Switch>
// 					</Tabs>
// 				</Suspense>
// 			</DialogDescription>
// 		</DialogHeader>
// 	);
// }

// function MobilityPanel() {
// 	const apps = createDbQuery((db) => getKey(db, "orgMobility"));

// 	return (
// 		<Card>
// 			<div class="w-full flex justify-between p-6 pb-0">
// 				<CardTitle class="h-5">Mobility</CardTitle>
// 			</div>
// 			<CardContent>
// 				<For
// 					each={latest(apps) || []}
// 					fallback={
// 						<p class="text-muted-foreground text-sm w-full text-center">
// 							No mobility applications found!
// 						</p>
// 					}
// 				>
// 					{(app) => (
// 						<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
// 							<dt class="text-sm font-medium leading-6 text-gray-900 flex space-x-2 items-center">
// 								<Avatar class="!rounded-md">
// 									{/* // TODO: Get the logo from Intune */}
// 									{/* <AvatarImage class="!rounded-md" src="" /> */}
// 									<AvatarFallback class="!rounded-md">
// 										{getInitials(app.displayName)}
// 									</AvatarFallback>
// 								</Avatar>

// 								<div>
// 									<h3>{app.displayName}</h3>
// 									<h4 class="text-xs text-muted-foreground">
// 										{app.description || ""}
// 									</h4>
// 								</div>
// 							</dt>
// 							<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
// 								<Tabs
// 									value={app.appliesTo}
// 									defaultValue="none"
// 									class="flex"
// 									disabled
// 									// onChange={() => alert("todo")}
// 								>
// 									<TabsList class="max-w-[250px] grid w-full grid-cols-3">
// 										<TabsTrigger value="none">None</TabsTrigger>
// 										<TabsTrigger value="all">All</TabsTrigger>
// 										<TabsTrigger value="selected">Some</TabsTrigger>
// 									</TabsList>
// 									<TabsContent
// 										value="selected"
// 										class="ml-4 flex space-x-2 items-center"
// 									>
// 										<For each={app.includedGroups || []}>
// 											{(group) => (
// 												<A href={`../groups/${group.id}`}>
// 													<Badge
// 														variant="ghost"
// 														class="bg-muted hover:shadow !rounded-md"
// 													>
// 														{group.displayName}
// 													</Badge>
// 												</A>
// 											)}
// 										</For>
// 										<button
// 											type="button"
// 											class={clsx(
// 												badgeVariants({
// 													variant: "ghost",
// 												}),
// 												"bg-muted hover:shadow !rounded-md",
// 												"disabled:cursor-not-allowed",
// 											)}
// 											disabled
// 											// TODO: Add a group flow
// 											// onClick={() => alert("todo")}
// 										>
// 											<IconPhPlusCircle />
// 										</button>
// 									</TabsContent>
// 								</Tabs>
// 							</dd>
// 						</div>
// 					)}
// 				</For>
// 			</CardContent>
// 		</Card>
// 	);
// }

// function AdvancedPanel() {
// 	const location = useLocation();
// 	const isDev = () =>
// 		import.meta.env.MODE === "development" || location.query?.dev !== undefined;

// 	return (
// 		<Card>
// 			<div class="w-full flex justify-between p-6 pb-0">
// 				<CardTitle class="h-5">Advanced</CardTitle>
// 			</div>
// 			<CardContent>
// 				<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
// 					<dt class="text-sm font-medium leading-6 text-gray-900">
// 						<h3>Show keyboard shortcuts</h3>
// 						<h4 class="text-xs text-muted-foreground">
// 							Show hints across the UI for keyboard shortcuts
// 						</h4>
// 					</dt>
// 					<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
// 						<USwitch
// 							checked={showKdbShortcuts()}
// 							onChange={() => setShowKdbShortcuts((v) => !v)}
// 						/>
// 					</dd>
// 				</div>
// 				<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
// 					<dt class="text-sm font-medium leading-6 text-gray-900">
// 						<h3>MDM backend</h3>
// 						<h4 class="text-xs text-muted-foreground">
// 							Configure the source of truth for device management
// 						</h4>
// 					</dt>
// 					<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
// 						<Select
// 							value="Microsoft Intune"
// 							options={["Microsoft Intune", "Mattrax"]}
// 							disabled={true}
// 							itemComponent={(props) => (
// 								<SelectItem item={props.item}>{props.item.rawValue}</SelectItem>
// 							)}
// 						>
// 							<SelectTrigger aria-label="MDM Backend" class="max-w-[180px]">
// 								<SelectValue<string>>
// 									{(state) => state.selectedOption()}
// 								</SelectValue>
// 							</SelectTrigger>
// 							<SelectContent />
// 						</Select>
// 					</dd>
// 				</div>
// 				<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
// 					<dt class="text-sm font-medium leading-6 text-gray-900">
// 						<h3>Link with Git provider</h3>
// 						<h4 class="text-xs text-muted-foreground">
// 							Connect with a Git provider for version control
// 						</h4>
// 					</dt>
// 					<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
// 						<Button
// 							variant="ghost"
// 							disabled={true}
// 							onClick={() => alert("todo")}
// 						>
// 							<IconLogosGithubIcon />
// 						</Button>
// 					</dd>
// 				</div>
// 			</CardContent>

// 			<Show when={isDev()}>
// 				<div class="w-full flex justify-between px-6">
// 					<CardTitle class="h-5">Development</CardTitle>
// 				</div>
// 				<CardContent>
// 					<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
// 						<dt class="text-sm font-medium leading-6 text-gray-900">
// 							<h3>Disable sync</h3>
// 							<h4 class="text-xs text-muted-foreground">
// 								Show hints across the UI for keyboard shortcuts
// 							</h4>
// 						</dt>
// 						<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
// 							<USwitch
// 								checked={syncDisabled()}
// 								onChange={() => setSyncDisabled((v) => !v)}
// 							/>
// 						</dd>
// 					</div>
// 				</CardContent>
// 			</Show>
// 		</Card>
// 	);
// }

// function DangerZone() {
// 	const navigate = useNavigate();
// 	const sync = useSync();

// 	const deleteDb = createMutation(() => ({
// 		mutationFn: async (data) => {
// 			sync.db.close();
// 			await window.indexedDB.deleteDatabase(sync.db.name);
// 			navigate("/");
// 		},
// 	}));

// 	return (
// 		<section>
// 			<h2 class="text-lg font-semibold">Danger Zone</h2>

// 			<div class="bg-red-100 rounded-md w-full py-4 px-6 mt-2 flex justify-between items-center">
// 				<div>
// 					<h6 class="text-red-700 text-md font-medium">
// 						Delete the local database!
// 					</h6>
// 					<p class="text-red-700 text-sm font-normal">
// 						This action will permanently remove all local data and you will be
// 						logged out!
// 					</p>
// 				</div>

// 				{/* // TODO: Confirmation dialog */}
// 				<Button
// 					variant="destructive"
// 					disabled={deleteDb.isPending}
// 					onClick={() => deleteDb.mutate()}
// 				>
// 					Delete
// 				</Button>
// 			</div>
// 		</section>
// 	);
// }

// function getCountryNameFromCode(code: string | undefined) {
// 	if (!code) return null;
// 	try {
// 		return new Intl.DisplayNames(["en"], {
// 			type: "region",
// 		}).of(code);
// 	} catch (t) {
// 		return code;
// 	}
// }
