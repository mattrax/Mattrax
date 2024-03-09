import { ErrorBoundary, ParentProps, Suspense } from "solid-js";

import { BreadcrumbsRoot } from "~/components/Breadcrumbs";
import { NavItemsProvider } from "./(dash)/NavItems";
import { MErrorBoundary } from "~/components/MattraxErrorBoundary";

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
