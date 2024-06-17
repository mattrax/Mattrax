import { Button } from "@mattrax/ui";
import { ErrorBoundary, type ParentProps } from "solid-js";

import { OscarTriedToDesignAMattraxLogoButFailedPrettyHard } from "~c/OscarTriedToDesignAMattraxLogoButFailedPrettyHard";

// A Mattrax styled error boundary.
export function MErrorBoundary(props: ParentProps) {
	return (
		<ErrorBoundary
			fallback={(err, reset) => {
				console.error(err);

				return (
					<div class="flex flex-col items-center justify-center h-full gap-4 py-4">
						<OscarTriedToDesignAMattraxLogoButFailedPrettyHard class="w-60" />
						<h1 class="text-3xl font-semibold">Something Went Wrong!</h1>
						<p class="text-gray-600 max-w-4xl">{err.toString()}</p>
						{err instanceof Error && (
							<code class="whitespace-pre max-w-6xl overflow-x-auto">
								{err.stack}
							</code>
						)}
						<Button onClick={reset}>Reload</Button>
					</div>
				);
			}}
		>
			{props.children}
		</ErrorBoundary>
	);
}
