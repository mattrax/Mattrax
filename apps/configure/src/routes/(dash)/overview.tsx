import { ErrorBoundary, Suspense } from "solid-js";
import { useSyncEngine } from "~/lib/sync";

export default function Page() {
	const sync = useSyncEngine();

	return (
		<div class="p-4">
			<h1>Authenticated</h1>
			<ErrorBoundary fallback={<p>Failed to load user...</p>}>
				<Suspense fallback={<p>Loading...</p>}>
					<pre>{sync.user()?.name}</pre>
					<pre>{sync.user()?.upn}</pre>
				</Suspense>
			</ErrorBoundary>
		</div>
	);
}
