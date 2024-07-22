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
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@mattrax/ui";
import { A, Navigate, useLocation, useNavigate } from "@solidjs/router";
import { createMutation } from "@tanstack/solid-query";
import clsx from "clsx";
import {
	For,
	type ParentProps,
	Show,
	Suspense,
	createEffect,
	createSignal,
	onMount,
} from "solid-js";
import { AccessTokenProvider, logout } from "../util/auth";
import {
	db,
	invalidateStore,
	resetDb,
	subscribeToInvalidations,
} from "../util/db";
import { syncAll, useUser } from "../util/sync";

export function useAccessTokenRaw() {
	const [accessToken, setAccessToken] = createSignal<string | null | undefined>(
		undefined,
	);
	const setAccessTokenCb = () =>
		db.then(async (db) =>
			setAccessToken((await db.get("_meta", "accessToken")) ?? null),
		);
	onMount(setAccessTokenCb);
	subscribeToInvalidations((store) => {
		if (store === "auth") setAccessTokenCb();
	});

	return accessToken;
}

export default function Layout(props: ParentProps) {
	const accessToken = useAccessTokenRaw();

	return (
		<>
			<Navbar />
			<Suspense>
				<Show when={accessToken() === null}>
					<Navigate href="/" />
				</Show>
				<Show when={accessToken()}>
					{(accessToken) => (
						<AccessTokenProvider accessToken={accessToken}>
							{props.children}
						</AccessTokenProvider>
					)}
				</Show>
			</Suspense>
		</>
	);
}

function Navbar() {
	return (
		<>
			<div class="relative flex flex-row items-center px-6 gap-2 h-16 shrink-0 border-b border-gray-200">
				<a href="/overview" class="uppercase font-extrabold text-2xl">
					MATTRAX CONFIGURE
				</a>

				<div class="flex-1" />

				<div class="flex space-x-2 justify-center items-center">
					{/* // TODO: Feedback button */}

					<SyncPanel />

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
			class="bg-white text-white sticky top-0 z-40 -mt-2 overflow-x-auto scrollbar-none shrink-0 flex flex-row"
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
			</Tabs.List>
			<Tabs.Indicator
				class="absolute bottom-0 flex flex-row px-2 h-[2px]"
				classList={{ "duration-200 transition-all": mounted() }}
			>
				<div class="bg-brand flex-1 rounded-full" />
			</Tabs.Indicator>
		</Tabs>
	);
}

function ProfileDropdown() {
	const navigate = useNavigate();
	const user = useUser();

	const logoutMutation = createMutation(() => ({
		mutationKey: ["logout"],
		mutationFn: async () => {
			await logout();
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
					<AvatarFallback>{getInitials(user.data?.name || "")}</AvatarFallback>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuLabel>
						<p>{user.data?.name}</p>
						<p class="text-sm">{user.data?.upn}</p>
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
	const accessToken = useAccessTokenRaw();
	const [syncing, setSyncing] = createSignal(false);
	const [triggerSync, setTriggerSync] = createSignal(0);

	/// TODO: Cross-tab sync the status
	createEffect(() => {
		const token = accessToken();
		triggerSync();
		if (token) {
			setSyncing(true);
			const now = performance.now();
			syncAll(token).then(() => {
				console.log(`Synced in ${performance.now() - now}ms`);
				setSyncing(false);
			});
		}
		// TODO: Catch errors and `setSyncing(false)`
	});

	return (
		<div class="flex">
			<Tooltip>
				<TooltipTrigger
					as="div"
					class={clsx(
						"flex justify-center items-center w-10",
						syncing() ? "" : "hidden",
					)}
				>
					<div class="relative inline-flex">
						<div class="w-5 h-5 bg-black rounded-full" />
						<div class="w-5 h-5 bg-black rounded-full absolute top-0 left-0 animate-ping" />
						<div class="w-5 h-5 bg-black rounded-full absolute top-0 left-0 animate-pulse" />
					</div>
				</TooltipTrigger>
				<TooltipContent>Actively syncing with Microsoft...</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger
					as={Button}
					variant="ghost"
					onClick={() => setTriggerSync((v) => v + 1)}
					disabled={syncing()}
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
