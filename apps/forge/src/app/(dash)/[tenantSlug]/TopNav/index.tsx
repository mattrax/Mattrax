import { As, Tabs } from "@kobalte/core";
import { A, useMatch, useNavigate, useResolvedPath } from "@solidjs/router";
import { For, JSX, ParentProps } from "solid-js";

import { createSignal } from "solid-js";
import { useAuth } from "~/app/(dash)";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
	Badge,
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
} from "~/components/ui";
import { trpc } from "~/lib";
import { TenantSwitcher, TenantSwitcherProps } from "./TenantSwitcher";
import Logo from "~/assets/MATTRAX.png";
import { createMemo } from "solid-js";
import { useTenant } from "../../[tenantSlug]";
import { Breadcrumbs } from "~/components/Breadcrumbs";

type NavbarItem = {
	title: string;
	href: string;
};

const tenantItems: NavbarItem[] = [
	{
		title: "Dashboard",
		href: "",
	},
	{
		title: "Users",
		href: "users",
	},
	{
		title: "Devices",
		href: "devices",
	},
	{
		title: "Policies",
		href: "policies",
	},
	{
		title: "Applications",
		href: "apps",
	},
	{
		title: "Groups",
		href: "groups",
	},
	{
		title: "Settings",
		href: "settings",
	},
];

const userItems: NavbarItem[] = [
	{
		title: "User",
		href: "",
	},
];

const deviceItems: NavbarItem[] = [
	{
		title: "Device",
		href: "",
	},
];

const policyItems: NavbarItem[] = [
	{
		title: "Policy",
		href: "",
	},
	{
		title: "Edit",
		href: "edit",
	},
	{
		title: "Assignees",
		href: "assignees",
	},
	{
		title: "History",
		href: "history",
	},
	{
		title: "Settings",
		href: "settings",
	},
];

const applicationItems: NavbarItem[] = [
	{
		title: "Application",
		href: "",
	},
];

const groupItems: NavbarItem[] = [
	{
		title: "Group",
		href: "",
	},
];

export default function Component(props: TenantSwitcherProps): JSX.Element {
	const auth = useAuth();

	const path = useResolvedPath(() => "");
	const tenantMatch = useMatch(() => `${path()}/*rest`);
	const userMatch = useMatch(() => `${path()}/users/:userId/*rest`);
	const deviceMatch = useMatch(() => `${path()}/devices/:deviceId/*rest`);
	const policyMatch = useMatch(() => `${path()}/policies/:policyId/*rest`);
	const applicationMatch = useMatch(() => `${path()}/apps/:appId/*rest`);
	const groupMatch = useMatch(() => `${path()}/groups/:groupId/*rest`);

	const matches = createMemo(() => {
		const user = userMatch();
		const device = deviceMatch();
		const policy = policyMatch();
		const application = applicationMatch();
		const group = groupMatch();

		if (user !== undefined) {
			return {
				items: userItems.map((i) => ({
					...i,
					href: `users/${user.params.userId}${
						i.href !== "" ? `/${i.href}` : ""
					}`,
					end: i.href === "",
					value: i.href,
				})),
				value: () => user.params.rest?.split("/")[0] ?? "",
			};
		}

		if (policy !== undefined) {
			return {
				items: policyItems.map((i) => ({
					...i,
					href: `policies/${policy.params.policyId}${
						i.href !== "" ? `/${i.href}` : ""
					}`,
					end: i.href === "",
					value: i.href,
				})),
				value: () => policy.params.rest?.split("/")[0] ?? "",
			};
		}

		if (device !== undefined) {
			return {
				items: deviceItems.map((i) => ({
					...i,
					href: `devices/${device.params.deviceId}${
						i.href !== "" ? `/${i.href}` : ""
					}`,
					end: i.href === "",
					value: i.href,
				})),
				value: () => device.params.rest?.split("/")[0] ?? "",
			};
		}

		if (application !== undefined) {
			return {
				items: applicationItems.map((i) => ({
					...i,
					href: `apps/${application.params.appId}${
						i.href !== "" ? `/${i.href}` : ""
					}`,
					end: i.href === "",
					value: i.href,
				})),
				value: () => application.params.rest?.split("/")[0] ?? "",
			};
		}

		if (group !== undefined) {
			return {
				items: groupItems.map((i) => ({
					...i,
					href: `groups/${group.params.groupId}${
						i.href !== "" ? `/${i.href}` : ""
					}`,
					end: i.href === "",
					value: i.href,
				})),
				value: () => group.params.rest?.split("/")[0] ?? "",
			};
		}

		return {
			items: tenantItems.map((i) => ({
				...i,
				value: i.href,
				end: i.href === "",
			})),
			value: () => tenantMatch()!.params.rest?.split("/")[0] ?? "",
		};
	});

	const navigate = useNavigate();
	const logout = trpc.auth.logout.useMutation(() => ({
		onSuccess: () => navigate("/login"),
	}));

	return (
		<>
			<div class="relative flex flex-row items-center px-6 gap-2 h-16 shrink-0">
				<A href="">
					<img src={Logo} class="h-5" alt="Mattrax icon" />
				</A>
				<div class="w-1" />
				<TenantSwitcher {...props} />
				<Breadcrumbs />
				<div class="flex-1" />
				<FeedbackPopover>
					<As component={Button} variant="outline" size="sm" class="mr-4">
						Feedback
					</As>
				</FeedbackPopover>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<As component={Avatar}>
							{/* TODO: Properly hook this up + Gravatar support */}
							{/* <AvatarImage src="https://github.com/otbeaumont.png" /> */}
							<AvatarFallback>{getInitials(auth().name)}</AvatarFallback>
						</As>
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						<DropdownMenuLabel>{auth().email}</DropdownMenuLabel>
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

			<nav class="text-white sticky border-b border-gray-300 top-0 z-10 bg-white -mt-2">
				<Tabs.Root value={matches().value()} class="mx-2 relative">
					<Tabs.List class="flex flex-row">
						<For each={matches().items}>
							{(item) => (
								<Tabs.Trigger asChild value={item.value}>
									<As
										component={A}
										end={item.end}
										href={item.href}
										activeClass="text-black selected"
										inactiveClass="text-gray-500"
										class="py-2 flex text-center align-middle transition duration-[16ms] relative group focus:outline-none"
									>
										<div class="text-sm rounded px-3 py-1.5 hover:bg-black/5 hover:text-black group-focus-visible:bg-black/5 group-focus-visible:text-black group-focus:outline-none">
											{item.title}
										</div>
									</As>
								</Tabs.Trigger>
							)}
						</For>
						<Tabs.Indicator class="absolute transition-all duration-200 -bottom-px flex flex-row px-2 h-[2px]">
							<div class="bg-brand flex-1" />
						</Tabs.Indicator>
					</Tabs.List>
				</Tabs.Root>
			</nav>
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
