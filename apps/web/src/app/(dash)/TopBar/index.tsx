import { useQueryClient } from "@tanstack/solid-query";
import { A, useMatch, useNavigate } from "@solidjs/router";
import { As } from "@kobalte/core";
import clsx from "clsx";
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
	Popover,
	PopoverContent,
	PopoverTrigger,
	Textarea,
} from "@mattrax/ui";
import {
	createEffect,
	createSignal,
	useTransition,
	type ParentProps,
} from "solid-js";

import { getInitials, trpc } from "~/lib";
import Logo from "~/assets/MATTRAX.png";
import { Breadcrumbs } from "~c/Breadcrumbs";
import { AuthContext, useAuth } from "~c/AuthContext";
import { NavItems, useNavItemsContext } from "./NavItems";

export function TopBar() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [_, start] = useTransition();
	const logout = trpc.auth.logout.useMutation(() => ({
		onSuccess: async () => {
			await start(() => navigate("/login"));
			queryClient.clear();
		},
	}));
	const { items } = useNavItemsContext();
	const user = trpc.auth.me.useQuery();

	const org = useMatch(() => "o/:orgSlug/*");

	return (
		<>
			<div
				class={clsx(
					"relative flex flex-row items-center px-6 gap-2 h-16 shrink-0",
					!items() && "border-b border-gray-200",
				)}
			>
				<A href={org()?.path ?? "/"} class="flex">
					<img src={Logo} class="h-5" alt="Mattrax icon" />
					<span class="ml-2 items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
						Alpha
					</span>
				</A>
				<Breadcrumbs />
				<div class="flex-1" />

				<AuthContext>
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
								{user.latest?.superadmin && (
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
					</div>
				</AuthContext>
			</div>
			<NavItems />
		</>
	);
}

function FeedbackPopover(props: ParentProps) {
	const sendFeedback = trpc.meta.sendFeedback.useMutation();
	const [open, setOpen] = createSignal(false);
	const [content, setContent] = createSignal("");

	return (
		<Popover open={open()} onOpenChange={setOpen}>
			<PopoverTrigger asChild>{props.children}</PopoverTrigger>
			<PopoverContent class="flex flex-col gap-2 md:w-[350px]">
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
