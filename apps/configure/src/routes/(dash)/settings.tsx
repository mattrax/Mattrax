import {
	Badge,
	Button,
	Card,
	CardContent,
	CardTitle,
	Progress,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Switch as USwitch,
	badgeVariants,
	buttonVariants,
} from "@mattrax/ui";
import { useNavigate } from "@solidjs/router";
import { createMutation } from "@tanstack/solid-query";
import clsx from "clsx";
import { For, Match, Show, Switch, onCleanup } from "solid-js";
import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";
import { getKey } from "~/lib/kv";
import { createDbQuery } from "~/lib/query";
import { useSync } from "~/lib/sync";
import { resetSyncState } from "~/lib/sync/operation";

export default function Page() {
	const org = createDbQuery((db) => getKey(db, "org"));

	return (
		<PageLayout heading={<PageLayoutHeading>Settings</PageLayoutHeading>}>
			<Card>
				<div class="w-full flex justify-between items-center p-6 pb-0">
					<CardTitle class="h-5">Tenant information</CardTitle>

					<a
						class={clsx(buttonVariants({ variant: "link" }), "!p-0")}
						classList={{
							"cursor-default select-none": !org()?.id,
						}}
						href={`https://portal.azure.com/${org()?.id}#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/Overview`}
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
							{/* // TODO: Allow changing it */}
							<dt class="text-sm font-medium leading-6 text-gray-900">Name</dt>
							<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
								{org()?.name}
							</dd>
						</div>
						<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
							{/* // TODO: Link to manage it */}
							<dt class="text-sm font-medium leading-6 text-gray-900">
								License
							</dt>
							<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
								{org()?.plan}
							</dd>
						</div>
						<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
							{/* // TODO: Allow copying it easily */}
							<dt class="text-sm font-medium leading-6 text-gray-900">
								Tenant ID
							</dt>
							<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
								<pre>{org()?.id}</pre>
							</dd>
						</div>
						<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
							<dt class="text-sm font-medium leading-6 text-gray-900">
								Country or region
							</dt>
							<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
								{getCountryNameFromCode(org()?.countryLetterCode)}
							</dd>
						</div>
					</dl>
				</CardContent>
			</Card>

			<BillingPanel />
			<DomainsPanel />
			<AdvancedPanel />

			<Actions />
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
							<span class="uppercase">{getPlan()?.[0] || "unknown"}</span>
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
							{getPlan()?.[1].cost}$
						</dd>
					</div>
					<div class="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
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
					</div>
				</dl>
			</CardContent>
		</Card>
	);
}

function DomainsPanel() {
	const org = createDbQuery((db) => getKey(db, "org"));

	return (
		<Card>
			<div class="w-full flex justify-between items-center p-6 pb-0">
				<CardTitle class="h-5">Domains</CardTitle>

				<a
					class={clsx(buttonVariants({ variant: "link" }), "!p-0")}
					classList={{
						"cursor-default select-none": !org()?.id,
					}}
					href={`https://portal.azure.com/${org()?.id}#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/Domains`}
					target="_blank"
					rel="noreferrer"
				>
					Microsoft Entra ID
					<IconPrimeExternalLink class="inline ml-1" />
				</a>
			</div>
			<CardContent>
				<dl class="divide-y divide-gray-100">
					<For each={org()?.verifiedDomains} fallback={<p>TODO</p>}>
						{(domain) => (
							<div class="px-4 py-3 sm:grid sm:grid-cols-4 sm:gap-4 sm:px-0">
								<dt class="text-sm font-medium leading-6 text-gray-900 sm:col-span-2">
									{domain.name}
								</dt>
								<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-1 sm:mt-0">
									<Switch>
										<Match
											// TODO: Hook up data - `!domain.isVerified`
											when={domain.name === "sg5hb.onmicrosoft.com"}
										>
											<a
												// TODO: Build a custom verification UI flow
												href={`https://portal.azure.com/${org()?.id}#view/Microsoft_AAD_IAM/DomainProperties.ReactView/domainName/${encodeURIComponent(domain.name)}/verificationSucceeded~/false`}
												target="_blank"
												class={clsx(
													badgeVariants({ variant: "ghost" }),
													"bg-orange-400 text-amber-100",
												)}
												classList={{
													"cursor-default select-none": !org()?.id,
												}}
												rel="noreferrer"
											>
												Verification required!
											</a>
										</Match>
										<Match
											// TODO: Hook up data - `domain.isPrimary`
											when={true}
										>
											<Badge>Primary</Badge>
										</Match>
										<Match when={domain.isInitial}>
											<Badge>Initial</Badge>
										</Match>
									</Switch>
								</dd>
								<dd class="mt-1 text-sm leading-6 text-gray-700 sm:col-span-1 sm:mt-0 flex space-x-2 justify-end">
									<Show
										// TODO: Hook up data -> `!domain.isPrimary`
										when={true}
									>
										<Button onClick={() => alert("TODO")}>Make primary</Button>
									</Show>
									<Button variant="destructive" onClick={() => alert("TODO")}>
										Delete
									</Button>
								</dd>
							</div>
						)}
					</For>
				</dl>
			</CardContent>
		</Card>
	);
}

function AdvancedPanel() {
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
						{/* // TODO: Hook this up */}
						<USwitch onChange={(e) => alert("todo")} />
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
							value="Intune"
							options={["Intune", "Mattrax"]}
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
		</Card>
	);
}

function Actions() {
	const navigate = useNavigate();
	const sync = useSync();

	const abort = new AbortController();
	onCleanup(() => abort.abort());

	const fullResync = createMutation(() => ({
		mutationFn: async (data) => {
			await resetSyncState(sync.db);
			await sync.syncAll(abort);
		},
	}));

	const deleteDb = createMutation(() => ({
		mutationFn: async (data) => {
			sync.db.close();
			await window.indexedDB.deleteDatabase(sync.db.name);
			navigate("/");
		},
	}));

	return (
		<section>
			<h2 class="text-lg font-semibold">Actions</h2>
			<div class="bg-slate-100 rounded-md w-full py-4 px-6 mt-2 flex justify-between items-center">
				<div>
					<h6 class="text-slate-700 text-md font-medium">Refresh database</h6>
					<p class="text-slate-700 text-sm font-normal">
						Completely refresh the local database with Microsoft!
					</p>
				</div>

				<Button
					disabled={fullResync.isPending}
					onClick={() => fullResync.mutate()}
				>
					Resync
				</Button>
			</div>

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
