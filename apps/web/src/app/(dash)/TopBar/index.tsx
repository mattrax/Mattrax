import { A, useIsRouting, useMatch, useNavigate } from "@solidjs/router";
import { As } from "@kobalte/core";
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
	Suspense,
	createSignal,
	useTransition,
	type ParentProps,
} from "solid-js";

import { getInitials, trpc } from "~/lib";
import Logo from "~/assets/MATTRAX.png";
import { Breadcrumbs } from "~c/Breadcrumbs";
import { AuthContext, useAuth } from "~c/AuthContext";
import { NavItems, useNavItemsContext } from "./NavItems";
import classes from "./NavIndicator.module.css";

export function TopBar() {
	const navigate = useNavigate();
	const [_, start] = useTransition();
	const logout = trpc.auth.logout.createMutation(() => ({
		// We reset caches on login
		onSuccess: () => start(() => navigate("/login")),
	}));
	const { items } = useNavItemsContext();
	const user = trpc.auth.me.createQuery();

	const org = useMatch(() => "o/:orgSlug/*");

	return (
		<>
			<div
				class={clsx(
					"relative flex flex-row items-center px-6 gap-2 h-16 shrink-0",
					!items() && "border-b border-gray-200",
				)}
			>
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
				<ContextMenu>
					<ContextMenuTrigger asChild>
						<As component={A} href={org()?.path ?? "/"} class="flex">
							<img src={Logo} class="h-5" alt="Mattrax icon" />
							<span class="ml-2 items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
								Alpha
							</span>
						</As>
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
				<Breadcrumbs />
				<div class="flex-1" />

				<div class="flex space-x-2 justify-center items-center">
					<FeedbackPopover>
						<As
							component={Button}
							variant="outline"
							size="sm"
							class="hidden md:block"
						>
							Feedback
						</As>
					</FeedbackPopover>

					<a
						href="https://docs.mattrax.app"
						class="text-gray-900 text-sm px-2 hover:text-gray-600"
						rel="noreferrer noopener"
						target="_blank"
					>
						Docs
					</a>

					<Suspense
						fallback={
							<Avatar>
								<AvatarFallback class="animate-pulse" />
							</Avatar>
						}
					>
						<AuthContext>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<As component={Avatar}>
										{/* TODO: Properly hook this up + Gravatar support */}
										{/* <AvatarImage src="https://github.com/otbeaumont.png" /> */}
										<AvatarFallback>
											{getInitials(useAuth()().name)}
										</AvatarFallback>
									</As>
								</DropdownMenuTrigger>
								<DropdownMenuContent>
									<DropdownMenuLabel>{useAuth()().email}</DropdownMenuLabel>
									<DropdownMenuSeparator />
									<DropdownMenuItem asChild>
										<As component={A} href="account">
											Account
										</As>
									</DropdownMenuItem>
									{user.data?.superadmin && (
										<DropdownMenuItem asChild>
											<As component={A} href="settings">
												Settings{" "}
												<span class="ml-2 inline-flex items-center rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-700/10">
													Superadmin
												</span>
											</As>
										</DropdownMenuItem>
									)}
									<DropdownMenuItem onClick={() => logout.mutate()}>
										Logout
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</AuthContext>
					</Suspense>
				</div>
			</div>
			<NavItems />
		</>
	);
}

function FeedbackPopover(props: ParentProps) {
	const sendFeedback = trpc.meta.sendFeedback.createMutation();
	const [open, setOpen] = createSignal(false);
	const [content, setContent] = createSignal("");

	return (
		<Popover open={open()} onOpenChange={setOpen}>
			<PopoverTrigger asChild>{props.children}</PopoverTrigger>
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
