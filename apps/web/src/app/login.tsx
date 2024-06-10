import type { ParentProps } from "solid-js";

export default function Layout(props: ParentProps) {
	return (
		<div class="flex-grow flex justify-center items-center">
			<div class="w-full flex flex-col items-center justify-center">
				<div class="sm:mx-auto sm:w-full sm:max-w-md flex items-center justify-center pb-2">
					<h2 class="mt-4 text-center text-4xl font-bold leading-9 tracking-tight text-gray-900">
						Mattrax
					</h2>
				</div>

				{props.children}
			</div>
		</div>
	);
}
