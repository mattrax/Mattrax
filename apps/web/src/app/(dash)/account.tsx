import { For, ParentProps, Suspense } from "solid-js";
import { A } from "@solidjs/router";
import { JSX } from "solid-js";

import { PageLayout, PageLayoutHeading } from "./PageLayout";
import { AuthContext } from "../AuthContext";
import { Breadcrumb } from "~/components/Breadcrumbs";

const navigation = [{ name: "API Keys", href: "api-keys" }];

export default function Layout(props: ParentProps) {
	return (
		<PageLayout
			size="lg"
			heading={<PageLayoutHeading>Account</PageLayoutHeading>}
		>
			<Breadcrumb>Account</Breadcrumb>
			<div class="flex flex-row">
				<nav class="sticky top-0 w-44 flex flex-col gap-y-5 bg-white pl-4">
					<ul class="space-y-1">
						<For each={navigation}>
							{(item) => (
								<SidebarItem href={item.href}>{item.name}</SidebarItem>
							)}
						</For>
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
