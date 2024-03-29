import { For, type ParentProps, Suspense } from "solid-js";
import { A } from "@solidjs/router";
import type { JSX } from "solid-js";

import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { AuthContext } from "~c/AuthContext";
import { trpc } from "~/lib";

const navigation = [
	{ name: "General", href: "general" },
	{ name: "API Keys", href: "api-keys" },
];

export const route = {
	info: {
		BREADCRUMB: { Component: () => <>Account</> },
	},
};

export default function Layout(props: ParentProps) {
	const user = trpc.auth.me.useQuery();

	return (
		<PageLayout
			size="lg"
			heading={<PageLayoutHeading>Account</PageLayoutHeading>}
		>
			<div class="flex flex-row">
				<nav class="sticky top-0 flex w-44 flex-col gap-y-5 bg-white pl-4">
					<ul class="space-y-1">
						<For each={navigation}>
							{(item) => (
								<SidebarItem href={item.href}>{item.name}</SidebarItem>
							)}
						</For>
						{(user.latest?.superadmin || user.latest?.features) && (
							<SidebarItem href="features">Features</SidebarItem>
						)}
					</ul>
				</nav>
				<main class="flex-1 overflow-y-auto px-4">
					<Suspense>
						<AuthContext>{props.children}</AuthContext>
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
		class="group block rounded-md p-2 text-sm font-semibold leading-6"
		activeClass="bg-gray-50 text-brand active-page"
		inactiveClass="text-gray-700 hover:text-brand hover:bg-gray-50 inactive-page"
	>
		<div>
			{props.icon && (
				<props.icon
					class={
						"group-[.active-page]:text-brand group-[.inactive-page]:group-hover:text-brand h-6 w-6 shrink-0 group-[.inactive-page]:text-gray-400"
					}
					aria-hidden="true"
				/>
			)}
			{props.children}
		</div>
	</A>
);
