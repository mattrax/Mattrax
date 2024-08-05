import { buttonVariants } from "@mattrax/ui";
import { createAsync } from "@solidjs/router";
import { Suspense } from "solid-js";
import { generateOAuthUrl } from "~/lib/auth";

export default function Page() {
	const loginUrl = createAsync(() => generateOAuthUrl());

	return (
		<div class="p-4">
			<Suspense>
				<h1 class="uppercase font-extrabold text-2xl mb-4">
					Mattrax Configure
				</h1>
				<a href={loginUrl()} class={buttonVariants()}>
					Login
				</a>
			</Suspense>
		</div>
	);
}
