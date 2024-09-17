import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuItem,
	DropdownMenuShortcut,
	DropdownMenuSeparator,
	Skeleton,
} from "@mattrax/ui";
import { Navigate, A } from "@solidjs/router";
import { minidenticon } from "minidenticons";
import { Suspense, Show, For, type JSX } from "solid-js";
import { z } from "zod";
import { useAccount, useTenants } from "~/lib/data";
import { useZodParams } from "~/lib/useZodParams";

const TriggerContent = (props: {
	icon: JSX.Element;
	children: JSX.Element;
}) => (
	<>
		<div class="flex h-5 w-5 items-center justify-center rounded-sm bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900">
			{props.icon}
		</div>
		<div class="line-clamp-1 flex-1 font-medium w-full">{props.children}</div>
	</>
);

export function TenantSwitcher() {
	const params = useZodParams({
		// This is optional as the sidebar should be available on `/account`, etc
		tenantId: z.string().optional(),
	});
	const account = useAccount();
	const tenants = useTenants();

	return (
		<DropdownMenu placement="right-start">
			<DropdownMenuTrigger
				class="w-full rounded-md ring-zinc-950 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 data-[state=open]:bg-zinc-100 dark:ring-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 dark:data-[state=open]:bg-zinc-800"
				disabled={tenants.isPending}
			>
				<div class="flex items-center gap-1.5 overflow-hidden px-2 py-1.5 text-left text-sm transition-all">
					<Suspense
						fallback={
							<TriggerContent icon={null}>
								<Skeleton height={14} radius={5} animate={false} />
							</TriggerContent>
						}
					>
						<Show
							when={params.tenantId}
							fallback={
								<TriggerContent
									icon={<IconPhUserBold class="h-3.5 w-3.5 shrink-0" />}
								>
									{account.data?.name}
								</TriggerContent>
							}
						>
							{(tenantId) => {
								return (
									<Show when={tenants.data}>
										{(tenants) => (
											<Show
												when={tenants().find((t) => t.id === tenantId())}
												fallback={<Navigate href="/" />}
											>
												{(tenant) => (
													<TriggerContent
														icon={
															<span
																class="h-3.5 w-3.5 shrink-0"
																innerHTML={minidenticon(tenant().id)}
															/>
														}
													>
														{tenant().name}
													</TriggerContent>
												)}
											</Show>
										)}
									</Show>
								);
							}}
						</Show>
					</Suspense>

					<IconPhCaretUpDown class="ml-auto h-4 w-4 text-zinc-500/50 dark:text-zinc-400/50" />
				</div>
			</DropdownMenuTrigger>
			<DropdownMenuContent class="w-64">
				<DropdownMenuLabel class="text-xs text-zinc-500 dark:text-zinc-400">
					Tenants
				</DropdownMenuLabel>
				{/* We disable the trigger so will never hit the fallback but it's here for safety. */}
				<Suspense>
					<For each={tenants.data || []}>
						{(tenant, index) => (
							<DropdownMenuItem
								as={A}
								href={`/t/${tenant.id}`}
								class="items-start gap-2 px-1.5"
							>
								<div class="flex h-8 w-8 items-center justify-center rounded-sm bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900">
									<span
										class="h-5 w-5 shrink-0"
										innerHTML={minidenticon(tenant.id)}
									/>
								</div>
								<div class="grid flex-1 leading-tight">
									<div class="line-clamp-1 font-medium">{tenant.name}</div>
									{/* <div class="overflow-hidden text-xs text-zinc-500 dark:text-zinc-400">
										<div class="line-clamp-1">{tenant.description}</div>
									</div> */}
								</div>
								<DropdownMenuShortcut class="self-center">
									⌘{index() + 1}
								</DropdownMenuShortcut>
							</DropdownMenuItem>
						)}
					</For>
				</Suspense>
				<DropdownMenuSeparator />
				<DropdownMenuItem as={A} href="/t/new" class="gap-2 px-1.5">
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
