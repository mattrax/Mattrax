// TODO: Lazy load part of page with this massive JSON blob
import { For, Suspense } from "solid-js";
import { useRestrictions } from "~/lib/useRestrictions";

export default function Component() {
	const restrictions = useRestrictions();

	return (
		<div class="flex flex-col space-y-4">
			<h1 class="text-3xl">Restrictions</h1>

			<Suspense fallback={<div>Loading...</div>}>
				{/* TODO: Make these the sidebar items */}
				<For each={restrictions.data?.sections}>
					{(section) => (
						<div>
							<h2 class="text-xl">{section.name}</h2>
							<For each={section.properties}>
								{(item) => (
									<div class="pl-8">
										<h3 class="text-lg">{item.name}</h3>
										<p>{item.description}</p>
										{/* TODO: Render input component w/ default value */}
										<p>{item.datatype}</p>
									</div>
								)}
							</For>
						</div>
					)}
				</For>
			</Suspense>
		</div>
	);
}
