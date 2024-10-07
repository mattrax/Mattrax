import { useLocation } from "@solidjs/router";

export default function () {
	const location = useLocation();

	return (
		<div class="flex h-full items-center justify-center">
			<div class="flex flex-col items-center justify-center">
				<h1 class="mt-4 text-3xl font-bold tracking-tight text-gray-900 sm:text-5xl">
					Not found
				</h1>
				<p class="text-muted-foreground opacity-70 pt-2 text-md text-center max-w-sm">
					The page <b>{location.pathname}</b> was not found!
				</p>

				<p class="text-muted-foreground opacity-70 pt-2 text-sm text-center max-w-sm">
					<a
						href={`mailto:hello@mattrax.app?subject=${encodeURIComponent("Page not found!")}&body=${encodeURIComponent(`I tried to access ${location.pathname} but the page doesn't exist.\n\nIf you remember how you got to this page please include it!`)}`}
						class="underline underline-offset-2 hover:text-black"
					>
						Report problem?
					</a>
				</p>
			</div>
		</div>
	);
}
