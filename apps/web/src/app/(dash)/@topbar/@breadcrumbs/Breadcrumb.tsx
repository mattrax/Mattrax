import { Suspense, type JSX, type ParentProps } from "solid-js";

// we use a dedicated object since otherwise all the fragments would merge
export function Breadcrumb(props: ParentProps) {
	return {
		breadcrumb: (
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

					{props.children}
				</Suspense>
			</div>
		),
	} as unknown as JSX.Element;
}
