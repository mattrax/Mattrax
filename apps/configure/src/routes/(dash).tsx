import { Tabs } from "@kobalte/core/tabs";
import {
	Avatar,
	AvatarFallback,
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Kbd,
	ProgressCircle,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
	buttonVariants,
} from "@mattrax/ui";
import { A, useLocation, useNavigate } from "@solidjs/router";
import { createMutation } from "@tanstack/solid-query";
import clsx from "clsx";
import {
	For,
	type ParentProps,
	Show,
	Suspense,
	createSignal,
	onMount,
} from "solid-js";
import { SyncEngineProvider, initSyncEngine, useSyncEngine } from "~/lib/sync";

export default function Layout(props: ParentProps) {
	const syncEngine = initSyncEngine();

	onMount(() => syncEngine.syncAll());

	return (
		<SyncEngineProvider engine={syncEngine}>
			<Navbar />

			{props.children}
		</SyncEngineProvider>
	);
}

function Navbar() {
	return (
		<>
			<div class="w-[100vw] relative flex flex-row items-center px-6 gap-2 h-16 shrink-0 border-b border-gray-200 z-10">
				<a href="/overview" class="uppercase font-extrabold text-2xl">
					MATTRAX CONFIGURE
				</a>

				<div class="flex-1" />

				<div class="flex space-x-2 justify-center items-center">
					{/* // TODO: Feedback button */}

					<SyncPanel />

					<Tooltip>
						<TooltipTrigger
							as="a"
							href="/search"
							class={clsx(buttonVariants({ variant: "ghost" }), "!m-0")}
						>
							<IconPhMagnifyingGlass />
						</TooltipTrigger>
						<TooltipContent>
							{/* // TODO: Hook up keyboard shortcut */}
							Search <Kbd>S</Kbd>
						</TooltipContent>
					</Tooltip>

					<ProfileDropdown />
				</div>
			</div>

			<NavItems />
		</>
	);
}

const items = [
	{ title: "Overview", href: "/overview" },
	{ title: "Users", href: "/users" },
	{ title: "Devices", href: "/devices" },
	{ title: "Groups", href: "/groups" },
	{ title: "Policies", href: "/policies" },
	{ title: "Applications", href: "/applications" },
	{ title: "Views", href: "/views" },
	{ title: "Settings", href: "/settings" },
];

function NavItems() {
	const location = useLocation();
	const [mounted, setMounted] = createSignal(false);

	// Wait for the first render + a microtask to finish before animating the indicator
	onMount(() => setTimeout(() => setMounted(true), 5));

	return (
		<Tabs
			as="nav"
			value={location.pathname}
			class="bg-white text-white sticky top-0 z-40 -mt-2 overflow-x-auto scrollbar-none shrink-0 flex flex-row z-10"
		>
			<Tabs.List class="flex flex-row px-2 border-b border-gray-200 w-full">
				<For each={items}>
					{(item) => (
						<Tabs.Trigger
							value={item.href}
							as={A}
							end={item.href === ""}
							href={item.href}
							activeClass="text-black selected"
							inactiveClass="text-gray-500"
							class="py-2 flex text-center align-middle relative group focus:outline-none"
						>
							<div class="text-sm rounded px-3 py-1.5 hover:bg-black/5 hover:text-black group-focus-visible:bg-black/5 group-focus-visible:text-black group-focus:outline-none transition-colors duration-75">
								{item.title}
							</div>
						</Tabs.Trigger>
					)}
				</For>

				{/* <div class="flex-1" /> */}

				{/* <div class="">
					<Tabs.Trigger
						value="/search"
						as={A}
						href="/search"
						activeClass="text-black selected"
						inactiveClass="text-gray-500"
						class="py-2 flex text-center align-middle relative group focus:outline-none"
					>
						<div class="text-sm rounded px-3 py-1.5 hover:bg-black/5 hover:text-black group-focus-visible:bg-black/5 group-focus-visible:text-black group-focus:outline-none transition-colors duration-75">
							<IconPhMagnifyingGlass />
						</div>
					</Tabs.Trigger>
				</div> */}
			</Tabs.List>

			<Show when={location.pathname !== "/search"}>
				<Tabs.Indicator
					class="absolute bottom-0 flex flex-row px-2 h-[2px]"
					classList={{ "duration-200 transition-all": mounted() }}
				>
					<div class="bg-brand flex-1 rounded-full" />
				</Tabs.Indicator>
			</Show>
		</Tabs>
	);
}

function ProfileDropdown() {
	const sync = useSyncEngine();
	const navigate = useNavigate();

	const logoutMutation = createMutation(() => ({
		mutationKey: ["logout"],
		mutationFn: async () => {
			await sync.logout();
			navigate("/");
		},
	}));

	return (
		<Suspense
			fallback={
				<Avatar>
					<AvatarFallback class="animate-pulse" />
				</Avatar>
			}
		>
			<DropdownMenu>
				<DropdownMenuTrigger as={Avatar}>
					{/* // TODO: Properly hook this up with Microsoft */}
					{/* <AvatarImage src="https://github.com/otbeaumont.png" /> */}
					<AvatarFallback>
						{getInitials(sync.user()?.name || "")}
					</AvatarFallback>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuLabel>
						<p>{sync.user()?.name}</p>
						<p class="text-sm">{sync.user()?.upn}</p>
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={() => logoutMutation.mutate()}
						disabled={logoutMutation.isPending}
					>
						Logout
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</Suspense>
	);
}

function SyncPanel() {
	const sync = useSyncEngine();

	return (
		<div class="flex">
			<Tooltip>
				<TooltipTrigger
					as="div"
					class={clsx(
						"flex justify-center items-center w-10",
						sync.isSyncing() ? "" : "hidden",
					)}
				>
					<ProgressCircle
						size="xs"
						value={sync.progress()}
						strokeWidth={
							sync.isSyncing() && sync.progress() === 0 ? 0 : undefined
						}
					>
						<div class="relative inline-flex">
							<div class="w-5 h-5 rounded-full" />
							<div class="w-5 h-5 bg-black rounded-full absolute top-0 left-0 animate-ping" />
							<Show when={sync.isSyncing() && sync.progress() === 0}>
								<div class="w-5 h-5 bg-black rounded-full absolute top-0 left-0 animate-pulse" />
							</Show>
						</div>
					</ProgressCircle>
				</TooltipTrigger>
				<TooltipContent>Progress syncing with Microsoft...</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger
					as={Button}
					variant="ghost"
					onClick={() => sync.syncAll()}
					disabled={sync.isSyncing()}
				>
					Sync
				</TooltipTrigger>
				<TooltipContent>Sync the local database with Microsoft!</TooltipContent>
			</Tooltip>
		</div>
	);
}

function getInitials(string: string) {
	const names = string.split(" ");
	// @ts-expect-error
	let initials = names[0].substring(0, 1).toUpperCase();

	if (names.length > 1) {
		// @ts-expect-error
		initials += names[names.length - 1].substring(0, 1).toUpperCase();
	}
	return initials;
}
