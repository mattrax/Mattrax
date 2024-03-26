import type { JSX } from "solid-js";
import { Label } from "@mattrax/ui";

export function Item(props: {
	label: string;
	data: JSX.Element;
}) {
	// TODO: Make this not look like ass
	return (
		<div class="flex flex-col space-y-1.5">
			<Label>{props.label}:</Label>
			{/* Avoid nested p tags */}
			{typeof props.data === "string" ? (
				<p class="py-1 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
					{props.data}
				</p>
			) : (
				<div class="py-1 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
					{props.data}
				</div>
			)}
		</div>
	);
}
