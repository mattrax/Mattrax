import clsx from "clsx";
import { type ParentProps, createSignal } from "solid-js";

export function SidebarLayout(props: ParentProps) {
	const [sidebar, setSidebar] = createSignal<"open" | "closed">("open");

	return (
		<div
			data-sidebar={sidebar()}
			style={{
				"--sidebar-width": "16rem",
			}}
			class={
				"min-h-screen max-w-screen bg-zinc-100/50 pl-0 transition-all duration-300 ease-in-out data-[sidebar=closed]:pl-0 sm:pl-[--sidebar-width] dark:bg-zinc-800/50"
			}
		>
			{props.children}
		</div>
	);
}

export function Sidebar(props: ParentProps) {
	const sidebar = (
		<div class="flex h-full flex-col border-r bg-white dark:bg-zinc-950">
			{props.children}
		</div>
	);

	// if (isMobile) {
	//   return (
	//     <Sheet open={open} onOpenChange={onOpenChange}>
	//       <SheetContent
	//         className="w-[260px] p-0 md:w-[--sidebar-width] [&>button]:hidden"
	//         side="left"
	//       >
	//         {sidebar}
	//       </SheetContent>
	//     </Sheet>
	//   )
	// }

	return (
		<aside class="fixed inset-y-0 left-0 z-10 hidden w-[--sidebar-width] transition-all duration-300 ease-in-out md:block [[data-sidebar=closed]_&]:left-[calc(var(--sidebar-width)*-1)]">
			{sidebar}
		</aside>
	);
}

export const SidebarHeader = (props: ParentProps) => (
	<div class="flex items-center border-b px-2.5 py-2">{props.children}</div>
);

export const SidebarFooter = (props: ParentProps) => (
	<div class="flex items-center border-t px-2.5 py-2">{props.children}</div>
);

export const SidebarContent = (props: ParentProps) => (
	<div class="flex flex-1 flex-col gap-5 overflow-auto py-4">
		{props.children}
	</div>
);

export const SidebarItem = (props: ParentProps & { class?: string }) => (
	<div class={clsx("grid gap-2 px-2.5", props.class)}>{props.children}</div>
);

export const SidebarLabel = (props: ParentProps) => (
	<div class="px-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
		{props.children}
	</div>
);
