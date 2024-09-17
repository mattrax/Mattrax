import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@mattrax/ui";
import { minidenticon } from "minidenticons";
import { For, type ParentProps } from "solid-js";
import { z } from "zod";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarItem,
	SidebarLabel,
	SidebarLayout,
} from "~/components/Sidebar";
import { Footer } from "~/components/Sidebar/Footer";
import { Navigation } from "~/components/Sidebar/Navigation";
import { OtherNavigation } from "~/components/Sidebar/OtherNavigation";
import { useZodParams } from "~/lib/useZodParams";

export default function (props: ParentProps) {
	return (
		<SidebarLayout>
			<Sidebar>
				<SidebarHeader>
					<TenantSwitcher />
				</SidebarHeader>
				<SidebarContent>
					<SidebarItem>
						{/* <SidebarLabel>Platform</SidebarLabel> */}
						<Navigation />
					</SidebarItem>
					<SidebarItem class="mt-auto">
						<SidebarLabel>Other</SidebarLabel>
						<OtherNavigation />
					</SidebarItem>
				</SidebarContent>
				<SidebarFooter>
					<Footer />
				</SidebarFooter>
			</Sidebar>
			<main class="p-4 w-full">{props.children}</main>
		</SidebarLayout>
	);
}

function TenantSwitcher() {
	const params = useZodParams({ tenantId: z.string() });

	// TODO: Hook all of this up to the backend
	const id = "abc";
	const name = "Acme School Inc";
	const teams = [
		{
			id: "abc",
			name: "Acme School Inc",
			description: "bruh, do the thing!",
		},
		{
			id: "cde",
			name: "Oscar's Tenant",
			description: "bruh, do the thing!",
		},
	];

	return (
		<DropdownMenu placement="right-start">
			<DropdownMenuTrigger class="w-full rounded-md ring-zinc-950 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 data-[state=open]:bg-zinc-100 dark:ring-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 dark:data-[state=open]:bg-zinc-800">
				<div class="flex items-center gap-1.5 overflow-hidden px-2 py-1.5 text-left text-sm transition-all">
					<div class="flex h-5 w-5 items-center justify-center rounded-sm bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900">
						<span class="h-3.5 w-3.5 shrink-0" innerHTML={minidenticon(id)} />
					</div>
					<div class="line-clamp-1 flex-1 pr-2 font-medium">{name}</div>
					<IconPhCaretUpDown class="ml-auto h-4 w-4 text-zinc-500/50 dark:text-zinc-400/50" />
				</div>
			</DropdownMenuTrigger>
			<DropdownMenuContent class="w-64">
				<DropdownMenuLabel class="text-xs text-zinc-500 dark:text-zinc-400">
					Tenants
				</DropdownMenuLabel>
				<For each={teams}>
					{(team, index) => (
						<DropdownMenuItem
							onClick={() => alert("todo")}
							class="items-start gap-2 px-1.5"
						>
							<div class="flex h-8 w-8 items-center justify-center rounded-sm bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900">
								<span
									class="h-5 w-5 shrink-0"
									innerHTML={minidenticon(team.id)}
								/>
							</div>
							<div class="grid flex-1 leading-tight">
								<div class="line-clamp-1 font-medium">{team.name}</div>
								<div class="overflow-hidden text-xs text-zinc-500 dark:text-zinc-400">
									<div class="line-clamp-1">{team.description}</div>
								</div>
							</div>
							<DropdownMenuShortcut class="self-center">
								⌘{index() + 1}
							</DropdownMenuShortcut>
						</DropdownMenuItem>
					)}
				</For>
				<DropdownMenuSeparator />
				<DropdownMenuItem class="gap-2 px-1.5">
					<div class="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
						<IconPhPlus class="h-5 w-5" />
					</div>
					<div class="font-medium text-zinc-500 dark:text-zinc-400">
						Create tenant
					</div>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
