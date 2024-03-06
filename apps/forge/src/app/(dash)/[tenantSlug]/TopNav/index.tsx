import { As, Tabs } from "@kobalte/core";
import { A, useMatch, useResolvedPath } from "@solidjs/router";
import { For, JSX, ParentProps, Show, Suspense, createEffect } from "solid-js";

import { createSignal } from "solid-js";
import { useAuth } from "~/app/(dash)";
import {
	Badge,
	Button,
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

export default function Component(props: TenantSwitcherProps): JSX.Element {
	const auth = useAuth();

	const path = useResolvedPath(() => "");
	const tenantMatch = useMatch(() => `${path()}/*rest`);
	const policyMatch = useMatch(() => `${path()}/policies/:policyId/*rest`);

	const matches = createMemo(() => {
		const policy = policyMatch();

		if (policy !== undefined) {
			return {
				items: policyItems.map((i) => ({
					...i,
					href: `policies/${policy.params.policyId}${
						i.href !== "" ? `/${i.href}` : ""
					}`,
					value: i.href,
				})),
				value: () => policy.params.rest?.split("/")[0] ?? "",
			};
		}

		return {
			items: tenantItems.map((i) => ({ ...i, value: i.href })),
			value: () => tenantMatch()!.params.rest?.split("/")[0] ?? "",
		};
	});

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
				<span class="font-medium">{auth().name}</span>
				{/* <Button variant="destructive">Log Out</Button> */}
			</div>

			<nav class="text-white sticky border-b border-gray-300 top-0 z-10 bg-white -mt-2">
				<Tabs.Root value={matches().value()} class="mx-2 relative">
					<Tabs.List class="flex flex-row">
						<For each={matches().items}>
							{(item) => (
								<Tabs.Trigger asChild value={item.value}>
									<As
										component={A}
										end={item.href === ""}
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
