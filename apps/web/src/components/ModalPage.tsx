import type { ParentProps } from "solid-js";
import { Transition } from "solid-transition-group";

export function ModalPage(props: ParentProps) {
	return (
		<div class="flex-1 flex justify-center items-center">
			<div class="animate-in slide-in-from-top-4 fade-in duration-500 min-h-[18rem] sm:w-full sm:max-w-xs">
				<div class="flex items-center justify-center pb-2">
					<h2 class="mt-4 text-center text-4xl font-bold leading-9 tracking-tight text-gray-900">
						Mattrax
					</h2>
				</div>

				<Transition
					mode="outin"
					enterClass="opacity-0"
					enterActiveClass="transition-opacity duration-200"
					enterToClass="opacity-100"
					exitClass="opacity-100"
					exitActiveClass="transition-opacity duration-20"
					exitToClass="opacity-0"
					appear={false}
				>
					{props.children}
				</Transition>
			</div>
		</div>
	);
}
