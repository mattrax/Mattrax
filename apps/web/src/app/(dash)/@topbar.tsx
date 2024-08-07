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
import { A, useIsRouting, useMatch, useNavigate } from "@solidjs/router";
import clsx from "clsx";
import {
	type ParentProps,
	Suspense,
	children,
	createSignal,
	startTransition,
} from "solid-js";

import LogoImg from "~/assets/MATTRAX.png";
import { useCommandGroup } from "~/components/CommandPalette";
import { getInitials, trpc } from "~/lib";
import type { RouteSectionProps } from "../(dash)";
import classes from "./@topbar/NavIndicator.module.css";
import { useAuth } from "./utils";

export default function (
	props: RouteSectionProps<never, "navItems" | "breadcrumbs">,
) {
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

				{props.slots.breadcrumbs}

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

			{navItems()}
		</>
	);
}

function FeedbackPopover(props: ParentProps) {
	const sendFeedback = trpc.meta.sendFeedback.createMutation();
	const [open, setOpen] = createSignal(false);
	const [content, setContent] = createSignal("");

	useCommandGroup("Account", [
		{
			title: "Submit Feedback",
			onClick: () => setOpen(true),
		},
	]);

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
			<ContextMenuTrigger
				as={A}
				href={org()?.path ?? "/"}
				class="flex flex-row items-center"
			>
				<img src={LogoImg} class="h-5" alt="Mattrax icon" />
				<span class="ml-2 items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
					Alpha
				</span>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuGroup>
					<ContextMenuGroupLabel>Links</ContextMenuGroupLabel>
					<ContextMenuItem
						as="a"
						href="https://github.com/mattrax/mattrax"
						target="_blank"
						rel="noreferrer"
					>
						GitHub
					</ContextMenuItem>
					<ContextMenuItem
						as="a"
						href="https://x.com/mattraxapp"
						target="_blank"
						rel="noreferrer"
					>
						X (Twitter)
					</ContextMenuItem>
				</ContextMenuGroup>
			</ContextMenuContent>
		</ContextMenu>
	);
}

function ProfileDropdown() {
	const navigate = useNavigate();

	const logout = trpc.auth.logout.createMutation(() => ({
		// We reset caches on login
		onSuccess: () => startTransition(() => navigate("/login")),
	}));
	// const { items } = useNavItemsContext();
	const account = useAuth();

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
					{/* TODO: Properly hook this up + Gravatar support */}
					{/* <AvatarImage src="https://github.com/otbeaumont.png" /> */}
					<AvatarFallback>
						{getInitials(account.data?.name || "")}
					</AvatarFallback>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuLabel>{account.data?.email}</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem as={A} href="account">
						Account
					</DropdownMenuItem>
					{account.data?.superadmin && (
						<DropdownMenuItem as={A} href="settings">
							Settings{" "}
							<span class="ml-2 inline-flex items-center rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-700/10">
								Superadmin
							</span>
						</DropdownMenuItem>
					)}
					<DropdownMenuItem
						onClick={() => logout.mutate()}
						disabled={logout.isPending}
					>
						Logout
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</Suspense>
	);
}
