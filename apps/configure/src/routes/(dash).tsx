import { Navigate } from "@solidjs/router";
import { type ParentProps, Show } from "solid-js";
import { accessToken } from "../util/auth";

export default function Layout(props: ParentProps) {
	return (
		<div class="p-4">
			<Show when={accessToken() !== null} fallback={<Navigate href="/" />}>
				{props.children}
			</Show>
		</div>
	);
}
