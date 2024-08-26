import {
	CommandDialog,
	CommandEmpty,
	CommandInput,
	CommandList,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@mattrax/ui";
import { A } from "@solidjs/router";
import { allDocs } from "content-collections";
import {
	For,
	type ParentProps,
	Show,
	createEffect,
	createSignal,
	onCleanup,
} from "solid-js";

type SidebarState = "open" | "visible" | "collapsed";

export default function Page(props: ParentProps) {
	return (
		<div class="w-full flex">
			<Sidebar />
			<main class="p-4 flex-1">{props.children}</main>
		</div>
	);
}

function Sidebar() {
	const [state, setState] = createSignal<SidebarState>("open");

	return (
		<div
			classList={{
				"absolute top-0 bottom-0": state() === "collapsed",
			}}
			onMouseLeave={() =>
				setState((p) => {
					if (p === "visible") return "collapsed";
					return p;
				})
			}
		>
			<div
				class="fixed inset-y-0 start-0 w-6 max-md:hidden xl:w-[50px]"
				onMouseEnter={() => setState("visible")}
			/>

			<div
				data-collapse={state() !== "open"}
				aria-hidden={state() !== "open"}
				tabIndex={state() === "collapsed" ? "-1" : undefined}
				class="fixed flex flex-col bg-fd-card text-sm md:sticky md:top-0 md:h-dvh md:w-[var(--fd-c-sidebar)] md:min-w-[var(--fd-sidebar-width)] md:border-e md:ps-[calc(var(--fd-c-sidebar)-var(--fd-sidebar-width))] max-md:inset-0 max-md:bg-fd-background/80 max-md:pt-14 max-md:text-[15px] max-md:backdrop-blur-md max-md:data-[open=false]:hidden"
				classList={{
					"md:translate-x-0": state() !== "open",
					"md:translate-x-[-100%]": state() === "collapsed",
				}}
			>
				<div class="flex-1">
					<LogoAndActions />
					<Search />
					<Items />
				</div>
				<Footer
					toggleCollapsed={() =>
						setState((prev) => (prev === "open" ? "collapsed" : "open"))
					}
				/>
			</div>

			<Show when={state() === "collapsed"}>
				<div class="absolute bottom-0 left-0 p-2">
					<CollapseSidebarButton
						toggleCollapsed={() =>
							setState((prev) => (prev === "open" ? "collapsed" : "open"))
						}
						tabIndex="0"
					/>
				</div>
			</Show>
		</div>
	);
}

function LogoAndActions() {
	return (
		<div class="flex justify-between items-center gap-1 px-4 pt-2 md:px-3 md:pt-4">
			<A href="/docs">
				<h1 class="uppercase font-extrabold text-2xl">MATTRAX</h1>
			</A>

			{/* // TODO: Fix focus rings! */}
			<DropdownMenu placement="bottom">
				<DropdownMenuTrigger as={IconPhDotsThreeBold} class="size-6" />
				<DropdownMenuContent class="!min-w-[200px] p-2">
					<DropdownMenuItem as="a" href="/" class="hover:bg-accent">
						Home
					</DropdownMenuItem>
					<DropdownMenuItem
						as="a"
						href="https://cloud.mattrax.app"
						class="hover:bg-accent"
					>
						Mattrax Cloud
					</DropdownMenuItem>
					<DropdownMenuItem
						as="a"
						href="https://github.com/mattrax/mattrax"
						class="hover:bg-accent"
					>
						<IconLogosGithubIcon class="size-4 mr-1" />
						GitHub
					</DropdownMenuItem>

					<DropdownMenuItem
						as="a"
						href="https://discord.gg/WPBHmDSfAn"
						class="hover:bg-accent"
					>
						<IconLogosDiscordIcon class="size-4 mr-1" />
						Discord
					</DropdownMenuItem>
					<DropdownMenuItem
						as="a"
						href="mailto:hello@mattrax.app"
						class="hover:bg-accent"
					>
						<IconPhEnvelopeBold class="size-4 mr-1" />
						Support
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function Search() {
	const cmdk = new EventTarget();

	return (
		<>
			<div class="w-full p-2">
				<button
					type="button"
					class="w-full inline-flex items-center gap-2 rounded-md border bg-fd-secondary/50 p-1.5 text-sm text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
					onClick={() => cmdk.dispatchEvent(new Event("open"))}
				>
					<IconPhMagnifyingGlass class="ms-1 size-4" />
					Search
					<div class="ms-auto inline-flex gap-0.5">
						<kbd class="rounded-md border bg-fd-background px-1.5">
							<Show
								when={navigator.platform.toUpperCase().indexOf("MAC") >= 0}
								fallback="Ctrl"
							>
								⌘
							</Show>
						</kbd>
						<kbd class="rounded-md border bg-fd-background px-1.5">k</kbd>
					</div>
				</button>
			</div>

			<CommandK cmdk={cmdk} />
		</>
	);
}

function CommandK(props: { cmdk: EventTarget }) {
	const [open, setOpen] = createSignal(false);

	createEffect(() => {
		const down = (e: KeyboardEvent) => {
			if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				setOpen((open) => !open);
			}
		};

		document.addEventListener("keydown", down);

		onCleanup(() => document.removeEventListener("keydown", down));
	});

	const onOpen = () => setOpen(true);
	props.cmdk.addEventListener("open", onOpen);
	onCleanup(() => props.cmdk.removeEventListener("open", onOpen));

	// TODO: Hook up search to the content
	// TODO: The "No results" text does a weird wiggle on open
	// TODO: Maybe only fade in, not resize like Fuma does????

	return (
		<CommandDialog open={open()} onOpenChange={setOpen}>
			<CommandInput
				placeholder="Search the documentation..."
				autocomplete="off"
				spellcheck={false}
			/>
			<CommandList>
				<CommandEmpty>No results found</CommandEmpty>
				{/* <CommandGroup heading="Suggestions">
					<CommandItem>Calendar</CommandItem>
					<CommandItem>Search Emoji</CommandItem>
					<CommandItem>Calculator</CommandItem>
				</CommandGroup> */}
			</CommandList>
		</CommandDialog>
	);
}

function Items() {
	return (
		<ul class="px-4 py-6 md:px-3">
			<For each={allDocs}>
				{(doc) => (
					<Item url={doc._meta.path === "overview" ? "/docs" : doc._meta.path}>
						{doc.title}
					</Item>
				)}
			</For>
		</ul>
	);
}

function Item(props: ParentProps<{ url: string }>) {
	return (
		<li>
			<A
				class="flex w-full flex-row items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-100 [overflow-wrap:anywhere] [&_svg]:size-4 hover:bg-fd-accent/50 hover:text-fd-accent-foreground/80 hover:transition-none"
				activeClass="bg-fd-primary/10 font-medium text-fd-primary"
				inactiveClass="text-fd-muted-foreground "
				href={props.url}
				end
			>
				{props.children}
			</A>
		</li>
	);
}

function Footer(props: {
	toggleCollapsed: () => void;
}) {
	return (
		<div class="flex flex-row items-center border-t py-1 max-md:px-4 md:mx-3">
			<button
				type="button"
				class="inline-flex items-center rounded-full border p-0.5"
				data-theme-toggle=""
				aria-label="Toggle Theme"
				onClick={() => {
					document.body.classList.toggle("dark");
					localStorage.setItem(
						"theme",
						document.body.classList.contains("dark") ? "dark" : "light",
					);
				}}
			>
				<IconLucideSun class="size-6 rounded-full p-1 bg-fd-accent text-fd-accent-foreground dark:bg-transparent dark:text-fd-muted-foreground" />
				<IconLucideMoon class="size-6 rounded-full p-1 text-fd-muted-foreground dark:bg-fd-accent dark:text-fd-accent-foreground" />
			</button>
			<CollapseSidebarButton {...props} />
		</div>
	);
}

function CollapseSidebarButton(props: {
	toggleCollapsed: () => void;
	tabIndex?: string;
}) {
	return (
		<button
			type="button"
			aria-label="Collapse Sidebar"
			class="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50 hover:bg-fd-accent hover:text-fd-accent-foreground p-1.5 [&amp;_svg]:size-5 ms-auto max-md:hidden"
			onClick={props.toggleCollapsed}
			tabIndex={props.tabIndex}
		>
			<IconLucidePanelLeft class="size-5" />
		</button>
	);
}
