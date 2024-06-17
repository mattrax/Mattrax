import { A } from "@solidjs/router";
import { For, type JSX, type ParentProps } from "solid-js";

import { trpc } from "~/lib";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";

const navigation = [
	{ name: "General", href: "general" },
	{ name: "API Keys", href: "api-keys" },
];

export default function Layout(props: ParentProps) {
	const user = trpc.auth.me.createQuery();

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
						{(user.data?.superadmin || user.data?.features) && (
							<SidebarItem href="features">Features</SidebarItem>
						)}
					</ul>
				</nav>
				<main class="flex-1 overflow-y-auto px-4">{props.children}</main>
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
