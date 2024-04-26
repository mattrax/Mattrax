/* @jsx React.createElement */
// TODO: If you move this file ensure you update `app.config.ts` to exclude it from Solid's JSX transform.

import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { OTPInput as _OTPInput, type SlotProps } from "input-otp";
import { onCleanup, onMount } from "solid-js";
import { cn } from "@mattrax/ui/lib";
import type { Props } from ".";
import { createAsync } from "@solidjs/router";

export default function OTPInput(props: Props) {
	const { promise, resolve } = Promise.withResolvers();

	const div = document.createElement("div");
	const suspenseSolidUntilReactRenders = createAsync(() => promise);

	onMount(() => {
		const root = createRoot(div);
		root.render(<Root resolve={resolve} props={props} />);
		onCleanup(() => root.unmount());
	});

	suspenseSolidUntilReactRenders();
	return div;
}

function Root({
	props: { onInput, onKeyDown, ...props },
	resolve,
}: { props: Props; resolve: () => void }) {
	useEffect(resolve);

	return (
		<_OTPInput
			maxLength={6}
			containerClassName="group flex items-center has-[:disabled]:opacity-30"
			render={({ slots }) => (
				<>
					<div className="flex">
						{slots.slice(0, 3).map((slot, idx) => (
							<Slot key={idx} {...slot} />
						))}
					</div>
					<FakeDash />
					<div className="flex">
						{slots.slice(3).map((slot, idx) => (
							<Slot key={idx} {...slot} />
						))}
					</div>
				</>
			)}
			onInput={(e) => {
				if (onInput) onInput(e.target.value);
			}}
			onKeyDown={(e) => {
				if (onKeyDown) onKeyDown(e);
			}}
			{...props}
		/>
	);
}

// Feel free to copy. Uses @shadcn/ui tailwind colors.
function Slot(props: SlotProps) {
	return (
		<div
			className={cn(
				"relative w-10 h-14 text-[2rem]",
				"flex items-center justify-center",
				"transition-all duration-300",
				"border-border border-y border-r first:border-l first:rounded-l-md last:rounded-r-md",
				"group-hover:border-accent-foreground/20 group-focus-within:border-accent-foreground/20",
				"outline outline-0 outline-accent-foreground/20",
				{ "outline-4 outline-accent-foreground": props.isActive },
			)}
		>
			{props.char !== null && <div>{props.char}</div>}
			{props.hasFakeCaret && <FakeCaret />}
		</div>
	);
}

// You can emulate a fake textbox caret!
function FakeCaret() {
	return (
		<div className="absolute pointer-events-none inset-0 flex items-center justify-center animate-caret-blink">
			<div className="w-px h-8 bg-white" />
		</div>
	);
}

// Inspired by Stripe's MFA input.
function FakeDash() {
	return (
		<div className="flex w-10 justify-center items-center">
			<div className="w-3 h-1 rounded-full bg-border" />
		</div>
	);
}
