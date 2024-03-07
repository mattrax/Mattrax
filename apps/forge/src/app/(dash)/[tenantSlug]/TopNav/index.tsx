import { As, Tabs } from "@kobalte/core";
import { A, useMatch, useNavigate, useResolvedPath } from "@solidjs/router";
import { createMemo, createSignal, For, JSX, ParentProps } from "solid-js";

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
} from "~/components/ui";
import { trpc } from "~/lib";
import { TenantSwitcher, TenantSwitcherProps } from "./TenantSwitcher";
import Logo from "~/assets/MATTRAX.png";
import { Breadcrumbs } from "~/components/Breadcrumbs";
import { AuthContext, useAuth } from "../../AuthContext";
import { TenantContext } from "../../TenantContext";

type NavbarItem = {
	title: string;
	href: string;
};

const navItems = {
	tenant: [
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
	],
	user: [
		{
			title: "User",
			href: "",
		},
		{
			title: "Scope",
			href: "scope",
		},
	],
	policy: [
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
	],
	device: [
		{ title: "Device", href: "" },
		{
			title: "Scope",
			href: "scope",
		},
		{
			title: "Inventory",
			href: "inventory",
		},
		{
			title: "Settings",
			href: "settings",
		},
	],
	application: [{ title: "Application", href: "" }],
	group: [{ title: "Group", href: "" }],
} satisfies Record<string, NavbarItem[]>;

export default function Component(props: TenantSwitcherProps): JSX.Element {
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
				items: navItems.user.map((i) => ({
					...i,
					href: `users/${user.params.userId}${
						i.href !== "" ? `/${i.href}` : ""
					}`,
					end: i.href === "",
					value: `user-${i.href}`,
				})),
				value: () => `user-${user.params.rest?.split("/")[0] ?? ""}`,
			};
		}

		if (policy !== undefined) {
			return {
				items: navItems.policy.map((i) => ({
					...i,
					href: `policies/${policy.params.policyId}${
						i.href !== "" ? `/${i.href}` : ""
					}`,
					end: i.href === "",
					value: `policy-${i.href}`,
				})),
				value: () => `policy-${policy.params.rest?.split("/")[0] ?? ""}`,
			};
		}

		if (device !== undefined) {
			return {
				items: navItems.device.map((i) => ({
					...i,
					href: `devices/${device.params.deviceId}${
						i.href !== "" ? `/${i.href}` : ""
					}`,
					end: i.href === "",
					value: `device-${i.href}`,
				})),
				value: () => `device-${device.params.rest?.split("/")[0] ?? ""}`,
			};
		}

		if (application !== undefined) {
			return {
				items: navItems.application.map((i) => ({
					...i,
					href: `apps/${application.params.appId}${
						i.href !== "" ? `/${i.href}` : ""
					}`,
					end: i.href === "",
					value: `application-${i.href}`,
				})),
				value: () =>
					`application-${application.params.rest?.split("/")[0] ?? ""}`,
			};
		}

		if (group !== undefined) {
			return {
				items: navItems.group.map((i) => ({
					...i,
					href: `groups/${group.params.groupId}${
						i.href !== "" ? `/${i.href}` : ""
					}`,
					end: i.href === "",
					value: `group-${i.href}`,
				})),
				value: () => `group-${group.params.rest?.split("/")[0] ?? ""}`,
			};
		}

		return {
			items: navItems.tenant.map((i) => ({
				...i,
				value: `tenant-${i.href}`,
				end: i.href === "",
			})),
			value: () => `tenant-${tenantMatch()!.params.rest?.split("/")[0] ?? ""}`,
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
				<AuthContext>
					<TenantContext>
						<TenantSwitcher {...props} />
					</TenantContext>
				</AuthContext>
				<Breadcrumbs />

				<div class="flex-1" />

				<AuthContext>
					<FeedbackPopover>
						<As
							component={Button}
							variant="outline"
							size="sm"
							class="mr-4 hidden md:block"
						>
							Feedback
						</As>
					</FeedbackPopover>

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
				</AuthContext>
			</div>

			<Tabs.Root
				as="nav"
				value={matches().value()}
				class="text-white sticky top-0 border-b border-gray-300 z-10 bg-white -mt-2 overflow-x-auto scrollbar-none shrink-0 flex flex-row"
			>
				<Tabs.List class="flex flex-row px-2">
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
									<div class="text-sm rounded px-3 py-1.5 hover:bg-black/5 hover:text-black group-focus-visible:bg-black/5 group-focus-visible:text-black group-focus:outline-none transition-colors duration-75">
										{item.title}
									</div>
								</As>
							</Tabs.Trigger>
						)}
					</For>
				</Tabs.List>
				<Tabs.Indicator class="absolute transition-all duration-200 -bottom-px flex flex-row px-2 h-[2px]">
					<div class="bg-brand flex-1" />
				</Tabs.Indicator>
			</Tabs.Root>
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
