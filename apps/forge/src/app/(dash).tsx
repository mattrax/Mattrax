import { ErrorBoundary, ParentProps, Suspense } from "solid-js";

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
			<Suspense>{props.children}</Suspense>
		</ErrorBoundary>
	);
}
