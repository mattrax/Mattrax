import {
	Avatar,
	AvatarFallback,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Skeleton,
} from "@mattrax/ui";
import { A, useNavigate } from "@solidjs/router";
import { Suspense, startTransition } from "solid-js";
import { getInitials, trpc } from "~/lib";
import { useAccount } from "~/lib/data";

export function Footer() {
	// TODO: Caching locally + redirect to login page
	// TODO: If unauthenticated redirect
	const account = useAccount();

	const navigate = useNavigate();
	const logout = trpc.auth.logout.createMutation(() => ({
		// We reset caches on login
		onSuccess: () => startTransition(() => navigate("/login")),
	}));

	return (
		<DropdownMenu placement="right-end">
			<DropdownMenuTrigger class="w-full rounded-md outline-none ring-zinc-950 hover:bg-zinc-100 focus-visible:ring-2 data-[state=open]:bg-zinc-100 dark:ring-zinc-300 dark:hover:bg-zinc-800 dark:data-[state=open]:bg-zinc-800">
				<div class="flex items-center gap-2 px-2 py-1.5 text-left text-sm transition-all">
					<Avatar class="h-7 w-7 rounded-md border">
						{/* // TODO: Properly hook this up + Gravatar support */}
						{/* <AvatarImage
							src={user.avatar}
							alt={user.name}
							class="animate-in fade-in-50 zoom-in-90"
						/> */}
						<AvatarFallback class="rounded-md">
							<Suspense>{getInitials(account.data?.name || "")}</Suspense>
						</AvatarFallback>
					</Avatar>
					<div class="grid flex-1 leading-none">
						<div class="font-medium h-[14px]">
							<Suspense
								fallback={<Skeleton height={14} radius={5} animate={false} />}
							>
								{account.data?.name}
							</Suspense>
						</div>
						<div class="overflow-hidden text-xs text-zinc-500 dark:text-zinc-400">
							<div class="line-clamp-1 h-[16px]">
								<Suspense
									fallback={
										<Skeleton
											height={16}
											radius={5}
											animate={false}
											class="mt-[4px]"
										/>
									}
								>
									{account.data?.email}
								</Suspense>
							</div>
						</div>
					</div>
					<IconPhCaretUpDownLight class="ml-auto mr-0.5 h-4 w-4 text-zinc-500/50 dark:text-zinc-400/50" />
				</div>
			</DropdownMenuTrigger>
			<DropdownMenuContent class="w-56">
				<DropdownMenuGroup>
					<DropdownMenuItem as={A} href="/account" class="gap-2">
						<IconPhCircleWavyCheck class="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
						Account
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					class="gap-2"
					onClick={() => logout.mutate()}
					disabled={logout.isPending}
				>
					<IconPhSignOut class="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
					Log out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
