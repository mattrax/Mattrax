import { Navigate, useParams } from "@solidjs/router";
import { parse } from "cookie-es";
import type { ParentProps } from "solid-js";
import { Transition } from "solid-transition-group";

export default function Layout(props: ParentProps) {
	const params = useParams();

	// We do this redirect in the layout so the empty layout doesn't render while navigating
	if (params?.code === undefined) {
		const cookies = parse(document.cookie);
		if (cookies.isLoggedIn === "true") return <Navigate href="/" />;
	}

	return (
		<div class="flex-1 flex flex-col">
			<div class="w-full flex-[10]" />
			<div class="flex flex-col items-center justify-start animate-in slide-in-from-top-4 fade-in duration-500 min-h-[18rem]">
				<div class="sm:mx-auto sm:w-full sm:max-w-md flex items-center justify-center pb-2">
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
			<div class="w-full flex-[12]" />
		</div>
	);
}
