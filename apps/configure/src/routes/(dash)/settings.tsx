import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@mattrax/ui";
import { A } from "@solidjs/router";
import type { JSX, ParentProps } from "solid-js";
import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";

export default function Page() {
	return (
		<PageLayout heading={<PageLayoutHeading>Settings</PageLayoutHeading>}>
			<div class="flex flex-row">
				<nav class="sticky top-0 w-44 flex flex-col gap-y-5 bg-white pl-4">
					<ul class="space-y-1">
						<SidebarItem href="">General</SidebarItem>
						{/* <SidebarItem href="#">Enrollment</SidebarItem> */}
					</ul>
				</nav>
				<main class="flex-1 overflow-y-auto px-4">
					<Card>
						<CardHeader>
							<CardTitle>Card Title</CardTitle>
							<CardDescription>Card Description</CardDescription>
						</CardHeader>
						<CardContent>
							<p>Card Content</p>
						</CardContent>
						{/* <CardFooter>
							<p>Card Footer</p>
						</CardFooter> */}
					</Card>
				</main>
			</div>
		</PageLayout>
	);
}

const SidebarItem = (
	props: ParentProps & {
		href: string;
		// disabled?: boolean;
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
