import { For, ParentProps, Suspense, SuspenseList, children } from "solid-js";

import IconMdiSlashForward from "~icons/mdi/slash-forward";

export default function (props: ParentProps) {
	const breadcrumbs = children(() => props.children);

	return (
		<div class="flex flex-row items-center text-sm font-medium space-x-2 text-gray-800">
			<SuspenseList revealOrder="forwards" tail="collapsed">
				<For each={breadcrumbs.toArray()}>
					{(element: any) => (
						<div class="flex flex-row items-center gap-2">
							<Suspense
								fallback={
									<>
										<IconMdiSlashForward class="text-lg text-gray-300" />
										<div class="w-24 h-4 rounded-full bg-neutral-200 animate-pulse" />
									</>
								}
							>
								<IconMdiSlashForward class="text-lg text-gray-300" />
								{element?.breadcrumb}
							</Suspense>
						</div>
					)}
				</For>
			</SuspenseList>
		</div>
	);
}
