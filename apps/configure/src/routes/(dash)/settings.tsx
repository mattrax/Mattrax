import {
	Badge,
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	Progress,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@mattrax/ui";
import { A, useNavigate } from "@solidjs/router";
import { createMutation } from "@tanstack/solid-query";
import {
	For,
	type JSX,
	type ParentProps,
	Show,
	Suspense,
	onCleanup,
} from "solid-js";
import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";
import { getKey } from "~/lib/kv";
import { createDbQuery } from "~/lib/query";
import { useSync } from "~/lib/sync";
import { resetSyncState } from "~/lib/sync/operation";

export default function Page() {
	const org = createDbQuery((db) => getKey(db, "org"));

	return (
		<PageLayout heading={<PageLayoutHeading>Settings</PageLayoutHeading>}>
			<div class="flex flex-row">
				<nav class="sticky top-0 w-44 flex flex-col gap-y-5 bg-white pl-4">
					<ul class="space-y-1">
						<SidebarItem href="">General</SidebarItem>
						{/* <SidebarItem href="#">Enrollment</SidebarItem> */}
					</ul>
				</nav>
				<main class="flex-1 overflow-y-auto px-4">
					<Card>
						<CardHeader>
							<CardTitle>
								{/* // TODO: Better Suspense UI */}
								<Suspense fallback="...">{org()?.name}</Suspense>
							</CardTitle>
							<CardDescription
								class="flex items-center space-x-4"
								// TODO: Animation wen copying to clipboard
								onClick={() => navigator.clipboard.writeText(org()?.id || "")}
							>
								{/* // TODO: Suspense UI */}
								<Suspense fallback="...">{org()?.id}</Suspense>
								<IconPhCopyDuotone />
							</CardDescription>
							<CardDescription>
								{/* // TODO: Better Suspense UI */}
								<Suspense fallback="...">{org()?.plan}</Suspense>
							</CardDescription>

							{/* // TODO: Show license */}
						</CardHeader>
						<CardContent class="flex flex-col space-y-2">
							<DomainPanel />
							<BillingPanel />
							<ActionsPanel />
						</CardContent>
					</Card>
				</main>
			</div>
		</PageLayout>
	);
}

function DomainPanel() {
	const org = createDbQuery((db) => getKey(db, "org"));

	return (
		<div class="pb-4">
			<h1 class="text-2xl font-bold tracking-tight">Domains</h1>
			<For each={org()?.verifiedDomains}>
				{(domain) => (
					<div class="flex space-x-2">
						<p>{domain.name}</p>
						<Show when={domain.isInitial}>
							<Badge>Initial</Badge>
						</Show>
					</div>
				)}
			</For>
		</div>
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
		<div class="flex flex-col space-y-2">
			<h1 class="text-2xl font-bold tracking-tight">Billing</h1>
			<p>Manage your billing to maintain access to Mattrax Configure.</p>

			<h2 class="text-md font-bold tracking-tight">Devices</h2>
			<Show when={getPlan()} keyed fallback={<p>Failed to find plan!</p>}>
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
			<p>
				Your currently managing{" "}
				<span class="font-bold tracking-tight uppercase">{devices()}</span> out
				of the maximum{" "}
				<span class="font-bold tracking-tight uppercase">
					{getPlan()?.[1].devices}
				</span>{" "}
				devices on plan{" "}
				<span class="font-bold tracking-tight uppercase">
					{getPlan()?.[0] || "unknown"}
				</span>{" "}
				which costs{" "}
				<span class="font-bold tracking-tight">
					{getPlan()?.[1].cost}$/month
				</span>
				.
			</p>
			<Button class="w-64" disabled={true} onClick={() => alert("TODO")}>
				Manage Billing Information
			</Button>
		</div>
	);
}

function ActionsPanel() {
	const navigate = useNavigate();
	const sync = useSync();
	const deleteDb = createMutation(() => ({
		mutationFn: async (data) => {
			sync.db.close();
			await window.indexedDB.deleteDatabase(sync.db.name);
			navigate("/");
		},
	}));

	const abort = new AbortController();
	onCleanup(() => abort.abort());

	const fullResync = createMutation(() => ({
		mutationFn: async (data) => {
			await resetSyncState(sync.db);
			await sync.syncAll(abort);
		},
	}));

	return (
		<>
			<h1 class="text-2xl font-bold tracking-tight">Actions</h1>
			<div class="flex space-x-4">
				<Tooltip>
					<TooltipTrigger
						as={Button}
						disabled={fullResync.isPending}
						onClick={() => fullResync.mutate()}
					>
						Full resync
					</TooltipTrigger>
					<TooltipContent>
						<p>Do a full resync of all data. This may take a while!</p>
					</TooltipContent>
				</Tooltip>

				{/* // TODO: Confirmation dialog */}
				<Tooltip>
					<TooltipTrigger
						as={Button}
						variant="destructive"
						disabled={deleteDb.isPending}
						onClick={() => deleteDb.mutate()}
					>
						Delete database
					</TooltipTrigger>
					<TooltipContent>
						<p>Delete all data for this user & logout!</p>
					</TooltipContent>
				</Tooltip>
			</div>
		</>
	);
}

const SidebarItem = (
	props: ParentProps & {
		href: string;
		// disabled?: boolean;
		icon?: (props: JSX.SvgSVGAttributes<SVGSVGElement>) => JSX.Element;
	},
) => (
	<A
		end
		href={props.href}
		class="block group rounded-md p-2 text-sm leading-6 font-semibold"
		activeClass="bg-gray-50 text-brand active-page"
		inactiveClass="text-gray-700 hover:text-brand hover:bg-gray-50 inactive-page"
	>
		<div>
			{props.icon && (
				<props.icon
					class={
						"h-6 w-6 shrink-0 group-[.active-page]:text-brand group-[.inactive-page]:text-gray-400 group-[.inactive-page]:group-hover:text-brand"
					}
					aria-hidden="true"
				/>
			)}
			{props.children}
		</div>
	</A>
);
