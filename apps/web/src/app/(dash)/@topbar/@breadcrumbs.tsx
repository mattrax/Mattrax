import { Show, For, type ParentProps, SuspenseList, children } from "solid-js";

export default function (props: ParentProps) {
	return (
		<div class="flex flex-row items-center text-sm font-medium space-x-2 text-gray-800">
			<SuspenseList revealOrder="forwards" tail="collapsed">
				<Show when>
					{(_) => {
						// children() has a createMemo that will invoke suspense before rendering
						// so we need to put it here
						const breadcrumbs = children(() => props.children);

						return (
							<For each={breadcrumbs.toArray()}>
								{(element: any) => <>{element?.breadcrumb}</>}
							</For>
						);
					}}
				</Show>
			</SuspenseList>
		</div>
	);
}
