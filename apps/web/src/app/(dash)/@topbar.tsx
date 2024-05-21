import {
	A,
	RouteSectionProps,
	useIsRouting,
	useMatch,
	useNavigate,
} from "@solidjs/router";
import clsx from "clsx";
import {
	Avatar,
	AvatarFallback,
	Button,
	ContextMenu,
	ContextMenuContent,
	ContextMenuGroup,
	ContextMenuGroupLabel,
	ContextMenuItem,
	ContextMenuTrigger,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Textarea,
} from "@mattrax/ui";
import {
	For,
	Suspense,
	SuspenseList,
	children,
	createSignal,
	useTransition,
	type ParentProps,
} from "solid-js";

import IconMdiSlashForward from "~icons/mdi/slash-forward";
import { getInitials, trpc } from "~/lib";
import LogoImg from "~/assets/MATTRAX.png";
import { AuthContext, useAuth } from "~c/AuthContext";
import classes from "./@topbar/NavIndicator.module.css";

export default function (
	props: RouteSectionProps<never, "navItems" | "breadcrumbs">,
) {
	const breadcrumbs = children(() => props.slots.breadcrumbs);
	const navItems = children(() => props.slots.navItems);

	return (
		<>
			<div
				class={clsx(
					"relative flex flex-row items-center px-6 gap-2 h-16 shrink-0",
					!navItems() && "border-b border-gray-200",
				)}
			>
				<NavigationAnnouncer />
				<Logo />

				<div class="flex flex-row items-center text-sm font-medium space-x-2 text-gray-800">
					<SuspenseList revealOrder="forwards" tail="collapsed">
						<For each={breadcrumbs.toArray()}>
							{(element: any) => (
								<div class="flex flex-row items-center gap-2">
									<Suspense
										fallback={
											<>
												<IconMdiSlashForward class="text-lg text-gray-300" />
												<div class="w-24 h-4 rounded-full bg-neutral-200 animate-pulse" />
											</>
										}
									>
										<IconMdiSlashForward class="text-lg text-gray-300" />
										{element?.breadcrumb}
									</Suspense>
								</div>
							)}
						</For>
					</SuspenseList>
				</div>

				<div class="flex-1" />

				<div class="flex space-x-2 justify-center items-center">
					<FeedbackPopover>
						<PopoverTrigger
							as={Button}
							variant="outline"
							size="sm"
							class="hidden md:block"
						>
							Feedback
						</PopoverTrigger>
					</FeedbackPopover>

					<a
						href="https://docs.mattrax.app"
						class="text-gray-900 text-sm px-2 hover:text-gray-600"
						rel="noreferrer noopener"
						target="_blank"
					>
						Docs
					</a>

					<ProfileDropdown />
				</div>
			</div>
			{(console.log(navItems()), navItems())}
		</>
	);
}

function FeedbackPopover(props: ParentProps) {
	const sendFeedback = trpc.meta.sendFeedback.createMutation();
	const [open, setOpen] = createSignal(false);
	const [content, setContent] = createSignal("");

	return (
		<Popover open={open()} onOpenChange={setOpen}>
			{props.children}
			<PopoverContent class="flex flex-col gap-2 md:w-[350px] p-4">
				<p class="text-sm text-gray-700">
					We welcome all feedback or bug reports:
				</p>
				<Textarea
					value={content()}
					onInput={(e) => setContent(e.target.value)}
				/>
				<Button
					class="w-full"
					onClick={async () => {
						sendFeedback.mutateAsync({ content: content() });
						setOpen(false);
						setContent("");
					}}
					disabled={sendFeedback.isPending}
					size="sm"
				>
					Submit
				</Button>
			</PopoverContent>
		</Popover>
	);
}

function NavigationAnnouncer() {
	return (
		<>
			{useIsRouting()() && (
				<div
					class={clsx(
						"animate-in fade-in duration-500 absolute h-1 top-0 inset-x-0",
					)}
				>
					<div
						class={clsx(
							"bg-blue-400 w-full h-full delay-500",
							classes.navIndicatorAnimation,
						)}
					/>
				</div>
			)}
		</>
	);
}

function Logo() {
	const org = useMatch(() => "o/:orgSlug/*");

	return (
		<ContextMenu>
			<ContextMenuTrigger as={A} href={org()?.path ?? "/"} class="flex">
				<img src={LogoImg} class="h-5" alt="Mattrax icon" />
				<span class="ml-2 items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
					Alpha
				</span>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuGroup>
					<ContextMenuGroupLabel>Links</ContextMenuGroupLabel>
					<ContextMenuItem>
						<a
							href="https://github.com/mattrax/mattrax"
							target="_blank"
							rel="noreferrer"
						>
							GitHub
						</a>
					</ContextMenuItem>
					<ContextMenuItem>Twitter</ContextMenuItem>
				</ContextMenuGroup>
			</ContextMenuContent>
		</ContextMenu>
	);
}

function ProfileDropdown() {
	const navigate = useNavigate();
	const [_, start] = useTransition();

	const logout = trpc.auth.logout.createMutation(() => ({
		// We reset caches on login
		onSuccess: () => start(() => navigate("/login")),
	}));
	// const { items } = useNavItemsContext();
	const user = trpc.auth.me.createQuery();

	return (
		<Suspense
			fallback={
				<Avatar>
					<AvatarFallback class="animate-pulse" />
				</Avatar>
			}
		>
			<AuthContext>
				<DropdownMenu>
					<DropdownMenuTrigger as={Avatar}>
						{/* TODO: Properly hook this up + Gravatar support */}
						{/* <AvatarImage src="https://github.com/otbeaumont.png" /> */}
						<AvatarFallback>{getInitials(useAuth()().name)}</AvatarFallback>
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						<DropdownMenuLabel>{useAuth()().email}</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<DropdownMenuItem as={A} href="account">
							Account
						</DropdownMenuItem>
						{user.data?.superadmin && (
							<DropdownMenuItem as={A} href="settings">
								Settings{" "}
								<span class="ml-2 inline-flex items-center rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-700/10">
									Superadmin
								</span>
							</DropdownMenuItem>
						)}
						<DropdownMenuItem onClick={() => logout.mutate()}>
							Logout
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</AuthContext>
		</Suspense>
	);
}
