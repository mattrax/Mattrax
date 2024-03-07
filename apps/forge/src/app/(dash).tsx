import { ErrorBoundary, ParentProps, Suspense } from "solid-js";

import { BreadcrumbsRoot } from "~/components/Breadcrumbs";
import { NavItemsProvider } from "./(dash)/NavItems";

export default function Layout(props: ParentProps) {
	return (
		<ErrorBoundary
			fallback={(err) => {
				console.error(err);

				return (
					<div class="p-2">
						<h1>Error</h1>
						<pre>{err.message}</pre>
					</div>
				);
			}}
		>
			<BreadcrumbsRoot>
				<NavItemsProvider>
					<Suspense>{props.children}</Suspense>
				</NavItemsProvider>
			</BreadcrumbsRoot>
		</ErrorBoundary>
	);
}
