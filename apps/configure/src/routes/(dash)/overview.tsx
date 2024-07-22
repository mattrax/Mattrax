import { ErrorBoundary, Suspense } from "solid-js";
import { useUser } from "../../util/sync";

export default function Page() {
	const me = useUser();

	return (
		<div class="p-4">
			<h1>Authenticated</h1>
			<ErrorBoundary fallback={<p>Failed to load user...</p>}>
				<Suspense fallback={<p>Loading...</p>}>
					<pre>{me.data?.name}</pre>
					<pre>{me.data?.upn}</pre>
				</Suspense>
			</ErrorBoundary>
		</div>
	);
}
