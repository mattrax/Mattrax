import clsx from "clsx";

export function Kbd(props: {
	variant?: "dark" | "light";
	class?: string;
	children: string;
}) {
	return (
		<kbd
			class={clsx(
				"pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium opacity-100",
				props.variant === "light"
					? "bg-muted text-muted-foreground"
					: "bg-primary text-primary-foreground border-primary-foreground/40",
				props.class,
			)}
		>
			{props.children}
		</kbd>
	);
}
