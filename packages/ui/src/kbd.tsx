import clsx from "clsx";
import type { JSX } from "solid-js";

export function Kbd(props: {
	class?: string;
	children: JSX.Element;
}) {
	return (
		<kbd
			class={clsx(
				"pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium opacity-100",
				"bg-muted text-muted-foreground",
				"dark:bg-primary dark:text-primary-foreground dark:border-primary-foreground/40",
				props.class,
			)}
		>
			{props.children}
		</kbd>
	);
}

export function getPlatformShortcut() {
	if (navigator.platform.startsWith("Mac")) return "⌘";
	return "Ctrl";
}
