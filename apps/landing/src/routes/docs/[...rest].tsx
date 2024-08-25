import { useParams } from "@solidjs/router";
import { allDocs } from "content-collections";
import { Show } from "solid-js";

export default function Page() {
	const params = useParams();

	// TODO: Can we make this work with static analysis so that we can lazy load the `content` of all pages???
	const doc = () => {
		const key = params.rest === "" ? "overview" : params.rest;
		return allDocs.find((d) => d._meta.path === key);
	};

	return (
		<Show when={doc()} fallback={<NotFoundPage />}>
			{(doc) => (
				<div>
					<h3 class="bold">{doc().title}</h3>
					<article class="prose lg:prose-md" innerHTML={doc().html} />
				</div>
			)}
		</Show>
	);
}

function NotFoundPage() {
	return (
		<div class="grid min-h-full place-items-center px-6 py-24 sm:py-32 lg:px-8">
			<div class="text-center">
				<p class="text-base font-semibold text-blue-600">404</p>
				<h1 class="mt-4 text-3xl font-bold tracking-tight text-gray-900 sm:text-5xl">
					Page not found
				</h1>
				<p class="mt-6 text-base leading-7 text-gray-600">
					Sorry, we couldn’t find the page you’re looking for.
				</p>
			</div>
		</div>
	);
}
