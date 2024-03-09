import { ParentProps, Suspense } from "solid-js";

import { BreadcrumbsRoot } from "~/components/Breadcrumbs";
import { NavItemsProvider } from "./(dash)/NavItems";
import { MErrorBoundary } from "~/components/MattraxErrorBoundary";
import { Route } from "@solidjs/router/dist/types";
import { trpc } from "~/lib";

export const route = {
	load: () => {
		trpc.useContext().auth.me.ensureData();
	},
};

export default function Layout(props: ParentProps) {
	return (
		<MErrorBoundary>
			<BreadcrumbsRoot>
				<NavItemsProvider>
					<Suspense>{props.children}</Suspense>
				</NavItemsProvider>
			</BreadcrumbsRoot>
		</MErrorBoundary>
	);
}
