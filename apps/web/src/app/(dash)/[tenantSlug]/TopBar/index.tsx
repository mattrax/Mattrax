import { As } from "@kobalte/core";
import { A, useNavigate } from "@solidjs/router";
import { createSignal, type JSX, type ParentProps } from "solid-js";

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
import { trpc } from "~/lib";
import { TenantSwitcher, type TenantSwitcherProps } from "./TenantSwitcher";
import Logo from "~/assets/MATTRAX.png";
import { Breadcrumbs } from "~/components/Breadcrumbs";
import { AuthContext, useAuth } from "../../AuthContext";
import { TenantContext } from "../../TenantContext";

export function TopBar(props: TenantSwitcherProps): JSX.Element {
	const navigate = useNavigate();
	const logout = trpc.auth.logout.useMutation(() => ({
		onSuccess: () => navigate("/login"),
	}));

	return (
		<div class="relative flex flex-row items-center px-6 gap-2 h-16 shrink-0">
			<A href="">
				<img src={Logo} class="h-5" alt="Mattrax icon" />
			</A>
			<div class="w-1" />
			<AuthContext>
				<TenantContext>
					<TenantSwitcher {...props} />
				</TenantContext>
				{/* // Technically this doesn't depend on auth but it's nicer UX for them to render left to right. */}
				<Breadcrumbs />
			</AuthContext>

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
						class="text-gray-900 text-sm px-2"
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
								<AvatarFallback>{getInitials(useAuth()().name)}</AvatarFallback>
							</As>
						</DropdownMenuTrigger>
						<DropdownMenuContent>
							<DropdownMenuLabel>{useAuth()().email}</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuItem asChild>
								<As component={A} href="/profile">
									Profile
								</As>
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => logout.mutate()}>
								Logout
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</AuthContext>
		</div>
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
