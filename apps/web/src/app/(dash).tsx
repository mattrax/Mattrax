import { ParentProps, Suspense } from "solid-js";

import { BreadcrumbsRoot } from "~/components/Breadcrumbs";
import { NavItemsProvider } from "./(dash)/TopBar/NavItems";
import { MErrorBoundary } from "~/components/MattraxErrorBoundary";
import { trpc } from "~/lib";
import { TopBar } from "./(dash)/TopBar";

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
					<TopBar />
					<Suspense>{props.children}</Suspense>
				</NavItemsProvider>
			</BreadcrumbsRoot>
		</MErrorBoundary>
	);
}
