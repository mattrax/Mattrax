import { Tabs } from "@kobalte/core/tabs";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
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
import {
	A,
	Navigate,
	createAsync,
	createAsyncStore,
	useCurrentMatches,
	useLocation,
	useNavigate,
} from "@solidjs/router";
import { createMutation } from "@tanstack/solid-query";
import clsx from "clsx";
import { type IDBPDatabase, openDB } from "idb";
import {
	ErrorBoundary,
	For,
	type ParentProps,
	Show,
	Suspense,
	createSignal,
	onCleanup,
	onMount,
} from "solid-js";
import { toast } from "solid-sonner";
import { z } from "zod";
import { type User, generateOAuthUrl, useUser } from "~/lib/auth";
import { createTimer2 } from "~/lib/createTimer";
import { type Database, dbVersion, openAndInitDb } from "~/lib/db";
import { getDbCached } from "~/lib/db-cache";
import { deleteKey, getKey } from "~/lib/kv";
import { createCrossTabListener, createDbQuery } from "~/lib/query";
import { SyncProvider, initSync, useSync } from "~/lib/sync";
import { useZodParams } from "~/lib/useZodParams";

export default function Layout(props: ParentProps) {
	const params = useZodParams({
		userId: z.string(),
	});

	return (
		<CapabilitiesOverlay>
			<Show when={params.userId} keyed>
				{(userId) => {
					const db = createAsync<IDBPDatabase<Database>>(async (prevDb) => {
						// TODO
						// if (prevDb) prevDb.close();
						// return await openAndInitDb(userId);
						return await getDbCached(userId);
					});

					return (
						<ErrorBoundary
							fallback={(err) => {
								if (
									// This event is when DB that doesn't exist is opened.
									// We do some hackery in `upgrade` when we detect this condition.
									err instanceof DOMException &&
									err.name === "AbortError"
								) {
									return <Navigate href="/" />;
								}

								return GenericErrorScreen(err);
							}}
						>
							<Suspense>
								<Show when={db()} keyed>
									{(db) => {
										const sync = initSync(db);
										createCrossTabListener(db);

										const abort = new AbortController();
										onMount(() => sync.syncAll(abort));
										onCleanup(() => {
											abort.abort();
											// db.close(); // TODO
										});

										return (
											<SyncProvider engine={sync}>
												{/* // TODO: Can we lift `Navbar` out of blocking section? */}
												<Suspense fallback={<ThrowOnSuspense id="header" />}>
													<Navbar />
												</Suspense>

												<ErrorBoundary fallback={GenericErrorScreen}>
													<Suspense>{props.children}</Suspense>
												</ErrorBoundary>
											</SyncProvider>
										);
									}}
								</Show>
							</Suspense>
						</ErrorBoundary>
					);
				}}
			</Show>
		</CapabilitiesOverlay>
	);
}

// This makes it easy to determine if we mess up suspense boundaries.
// We should never be relying on the layout's suspense, we should be suspending at the leaves of the page!
// If we just return `null` instead of suspending the UI might jank (Eg. the navbar just disappearing)
function ThrowOnSuspense(props: { id: string }): null {
	throw new Error(`The ${props.id} triggered the layout suspense!`);
}

function CapabilitiesOverlay(props: ParentProps) {
	return (
		<Show
			when={"locks" in navigator}
			fallback={
				<ErrorScreen>
					Your browser does not support Web Locks. <br />
					Please upgrade your browser to use Mattrax.
				</ErrorScreen>
			}
		>
			<Show
				when={"indexedDB" in window}
				fallback={
					<ErrorScreen>
						Your browser does not support IndexedDB. <br />
						Please upgrade your browser to use Mattrax.
					</ErrorScreen>
				}
			>
				{props.children}
			</Show>
		</Show>
	);
}

function GenericErrorScreen(err: Error) {
	const mutation = createMutation(() => ({
		mutationFn: async (data) => {
			const databases = await indexedDB.databases();
			for (const { name, version } of databases) {
				if (!name || !version) continue;
				if (version !== dbVersion) continue;
				await indexedDB.deleteDatabase(name);
				location.reload();
			}
		},
	}));

	return (
		<ErrorScreen>
			Error while initializing the page.
			<pre>{err.toString()}</pre>
			<br />
			Please reload the page to try again! <br />
			If your having persistent issues, you can try to{" "}
			<button
				type="button"
				class="underline"
				disabled={mutation.isPending}
				onClick={async () => {
					// `await` in case we are in Tauri.
					if (
						await confirm(
							"Are you sure you want to reset all local data?\nYou will loose everything not synced with Microsoft including views.",
						)
					) {
						mutation.mutate();
					}
				}}
			>
				reset everything
			</button>
			.
		</ErrorScreen>
	);
}

function ErrorScreen(props: ParentProps) {
	return (
		<div class="absolute top-0 left-0 h-screen w-screen flex justify-center items-center">
			<div class="w-full flex flex-col items-center justify-center">
				<div class="sm:mx-auto sm:w-full sm:max-w-md flex items-center justify-center pb-2">
					<h2 class="mt-4 text-center text-4xl font-bold leading-9 tracking-tight text-gray-900">
						Mattrax
					</h2>
				</div>

				<p class="text-muted-foreground text-md text-center">
					{props.children}
				</p>
			</div>
		</div>
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
	{ title: "Overview", href: "" },
	{ title: "Users", href: "users" },
	{ title: "Devices", href: "devices" },
	{ title: "Groups", href: "groups" },
	{ title: "Policies", href: "policies" },
	{ title: "Applications", href: "applications" },
	{ title: "Views", href: "views" },
	{ title: "Settings", href: "settings" },
];

function NavItems() {
	const location = useLocation();
	const [mounted, setMounted] = createSignal(false);

	// Wait for the first render + a microtask to finish before animating the indicator
	onMount(() => setTimeout(() => setMounted(true), 5));

	const matches = useCurrentMatches();
	const relativeUrl = (url: string) => `${matches?.[0]?.path || ""}${url}`;

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
							value={relativeUrl(item.href)}
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

			{/* <Show when={location.pathname !== "/search"}> */}
			<Tabs.Indicator
				class="absolute bottom-0 flex flex-row px-2 h-[2px]"
				classList={{ "duration-200 transition-all": mounted() }}
			>
				<div class="bg-brand flex-1 rounded-full" />
			</Tabs.Indicator>
			{/* </Show> */}
		</Tabs>
	);
}

function ProfileDropdown() {
	const user = useUser();
	const navigate = useNavigate();
	const sync = useSync();

	const logoutMutation = createMutation(() => ({
		mutationKey: ["logout"],
		mutationFn: async () => {
			await deleteKey(sync.db, "accessToken");
			await deleteKey(sync.db, "refreshToken");
			await deleteKey(sync.db, "user");
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
					<Show when={user()?.avatar}>
						{(src) => <AvatarImage src={src()} />}
					</Show>
					<AvatarFallback>{getInitials(user()?.name || "")}</AvatarFallback>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					<ProfileDropdownAccountSwitcher user={user()} />

					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => alert("TODO")} disabled={true}>
						Account settings
					</DropdownMenuItem>

					<DropdownMenuSeparator />
					<DropdownMenuItem as="a" href="/home">
						Home Page
					</DropdownMenuItem>
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

function ProfileDropdownAccountSwitcher(props: { user: User | undefined }) {
	const sync = useSync();

	const databases = createAsyncStore(async () =>
		(
			await Promise.allSettled(
				(
					await window.indexedDB.databases()
				).map(async (database) => {
					// How is this even possible
					if (!database.name || !database.version) return;
					// We also skip the currently active DB
					if (database.name === sync.db.name) return;
					// We open using raw IndexedDB as we don't want to modify the schema.
					const db = await openDB(database.name, database.version);
					// This is probably not a Mattrax DB
					if (!db.objectStoreNames.contains("_kv")) return;
					// Get user and org
					const user = await getKey(db as any, "user");
					const org = await getKey(db as any, "org");
					if (!user || !org) return;
					// Cleanup
					db.close();

					return [user, org] as const;
				}),
			)
		)
			.filter((x) => x.status === "fulfilled")
			.map((x) => x.value)
			.filter((x) => x !== undefined),
	);

	const loginUrl = createAsync(() => generateOAuthUrl("select_account"));

	return (
		<DropdownMenu sameWidth>
			<DropdownMenuTrigger>
				<DropdownMenuLabel class="hover:bg-gray-200 rounded-md w-full">
					<p>{props.user?.name}</p>
					<p class="text-sm">{props.user?.upn}</p>
				</DropdownMenuLabel>
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				<Suspense fallback={<p>Loading...</p>}>
					<For each={databases()}>
						{([user, org]) => (
							<a href={`/${user.id}`}>
								<DropdownMenuLabel class="hover:bg-gray-200 rounded-md">
									<p>{user.name}</p>
									<p class="text-sm">{user.upn}</p>
								</DropdownMenuLabel>
							</a>
						)}
					</For>
					<Show
						when={databases()?.length === 0}
						fallback={<DropdownMenuSeparator />}
					>
						{null}
					</Show>
				</Suspense>
				<DropdownMenuItem as="a" href={loginUrl()}>
					Add another account
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function SyncPanel() {
	const sync = useSync();

	const [isSyncing, setIsSyncing] = createSignal(false);

	// Polling is not *great* but it's the most reliable way to keep track across tabs because the Web Lock's API has no way to listen for changes.
	const isSyncingCheck = createTimer2(
		async () => {
			const locks = await navigator.locks.query();
			setIsSyncing(locks.held?.find((l) => l.name === "sync") !== undefined);
		},
		// We regularly poll because we just can't trust that the other tab will tell us when it releases the lock (it could have crashed/been closed)
		// We can pretty safely assume we will get a message when the lock is acquired but not when it's released.
		// Given this we poll a lot more aggressively when we're holding the lock.
		() => (isSyncing() ? 250 : 1000),
	);
	isSyncingCheck.trigger();

	const progressRaw = createDbQuery(async (db) => {
		isSyncingCheck.trigger();

		let total = 0;
		const metas = await db.getAll("_meta");
		for (const meta of metas) {
			if ("syncedAt" in meta) {
				total += (1 / metas.length) * 1;
			} else {
				const innerProgress = meta.completed / meta.total;
				if (Number.isNaN(innerProgress)) continue;
				total += (1 / metas.length) * innerProgress;
			}
		}
		return total * 100;
	});

	// Avoid suspending
	const progress = () => progressRaw.latest ?? 0;

	const abort = new AbortController();
	onCleanup(() => abort.abort());

	return (
		<div class="flex">
			<Tooltip>
				<TooltipTrigger
					as="div"
					class={clsx(
						"flex justify-center items-center w-10",
						isSyncing() ? "" : "hidden",
					)}
				>
					<ProgressCircle
						size="xs"
						value={progress()}
						strokeWidth={isSyncing() && progress() === 0 ? 0 : undefined}
					>
						<div class="relative inline-flex">
							<div class="w-5 h-5 rounded-full" />
							<div class="w-5 h-5 bg-black rounded-full absolute top-0 left-0 animate-ping" />
							<Show when={isSyncing() && progress() === 0}>
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
					onClick={() =>
						sync.syncAll(abort).then((elapsed) => {
							if (elapsed)
								toast.success(
									`Successfully synced with Microsoft in ${elapsed}s`,
								);
						})
					}
					disabled={isSyncing()}
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
