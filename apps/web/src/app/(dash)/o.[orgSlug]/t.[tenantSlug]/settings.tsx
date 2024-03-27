import { For, type JSX, type ParentProps, Suspense } from "solid-js";
import { A } from "@solidjs/router";

import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { AuthContext } from "~c/AuthContext";
import { TenantContext } from "./Context";
import IcRoundArrowForward from "~icons/ic/round-arrow-forward";

const navigation = [
	{ name: "General", href: "" },
	{ name: "Administrators", href: "administrators" },
	{ name: "Identity Provider", href: "identity-provider" },
	{ name: "Enrollment", href: "enrollment" },
	{ name: "Audit Log", href: "audit-log" },
];

export default function Layout(props: ParentProps) {
	return (
		<PageLayout
			size="lg"
			heading={<PageLayoutHeading>Tenant Settings</PageLayoutHeading>}
		>
			<div class="flex flex-row">
				<nav class="sticky top-0 w-44 flex flex-col bg-white pl-4">
					<ul class="space-y-1">
						<For each={navigation}>
							{(item) => (
								<SidebarItem href={item.href}>{item.name}</SidebarItem>
							)}
						</For>
					</ul>
					<span class="text-sm text-gray-500 font-medium mt-4 mb-2">
						Organisation Settings
					</span>
					<ul class="space-y-1">
						<For
							each={[{ name: "Billing", href: "../../../settings/billing" }]}
						>
							{(item) => (
								<SidebarItem href={item.href}>
									<div class="flex flex-row items-center justify-between ">
										{item.name} <IcRoundArrowForward class="block" />
									</div>
								</SidebarItem>
							)}
						</For>
					</ul>
				</nav>
				<main class="flex-1 overflow-y-auto px-4">
					<Suspense>
						<AuthContext>
							<TenantContext>{props.children}</TenantContext>
						</AuthContext>
					</Suspense>
				</main>
			</div>
		</PageLayout>
	);
}

const SidebarItem = (
	props: ParentProps & {
		href: string;
		disabled?: boolean;
		icon?: (props: JSX.SvgSVGAttributes<SVGSVGElement>) => JSX.Element;
	},
) => (
	<A
		end
		href={props.href}
		class="block group rounded-md p-2 text-sm leading-6 font-semibold"
		activeClass="bg-gray-50 text-brand active-page"
		inactiveClass="text-gray-700 hover:text-brand hover:bg-gray-50 inactive-page"
	>
		<div>
			{props.icon && (
				<props.icon
					class={
						"h-6 w-6 shrink-0 group-[.active-page]:text-brand group-[.inactive-page]:text-gray-400 group-[.inactive-page]:group-hover:text-brand"
					}
					aria-hidden="true"
				/>
			)}
			{props.children}
		</div>
	</A>
);
