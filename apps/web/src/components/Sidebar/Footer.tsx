import {
	Avatar,
	AvatarFallback,
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Skeleton,
} from "@mattrax/ui";
import { useNavigate } from "@solidjs/router";
import { Suspense, startTransition } from "solid-js";
import { toast } from "solid-sonner";
import { getInitials, trpc } from "~/lib";

export function Footer() {
	// TODO: Caching locally + redirect to login page
	// TODO: If unauthenticated redirect
	const account = trpc.auth.me.createQuery();

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
			{/* This kinda sucks but we need the dialog to exist outside the dropdown so it doesn't unmount. */}
			<Dialog>
				<DropdownMenuContent class="w-56">
					<DropdownMenuGroup>
						<DialogTrigger as={DropdownMenuItem} class="gap-2">
							<IconPhCircleWavyCheck class="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
							Account
						</DialogTrigger>
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
				<ManageAccountDialogContent />
			</Dialog>
		</DropdownMenu>
	);
}

function ManageAccountDialogContent() {
	const me = trpc.auth.me.createQuery();

	// TODO: Rollback form on failure
	// TODO: Optimistic UI?
	const updateAccount = trpc.auth.update.createMutation(() => ({
		onSuccess: () =>
			toast.success("Account updated", {
				id: "account-updated",
			}),
		// ...withDependantQueries(me), // TODO: Implement
	}));

	// const form = createZodForm(() => ({
	// 	schema: z.object({ name: z.string(), email: z.string().email() }),
	// 	// TODO: We should use a function for this so it updates from the server data when the fields aren't dirty.
	// 	// TODO: Right now this breaks the field focus
	// 	defaultValues: {
	// 		name: me.data?.name || "",
	// 		email: me.data?.email || "",
	// 	},
	// 	onSubmit: ({ value }) =>
	// 		updateAccount.mutateAsync({
	// 			name: value.name,
	// 		}),
	// }));

	// const triggerSave = debounce(() => {
	// 	// TODO: This should probs use the form but it disabled the field which is annoying AF.
	// 	updateAccount.mutateAsync({
	// 		name: form.getFieldValue("name"),
	// 	});
	// }, 500);

	return (
		<DialogContent>
			<DialogHeader>
				<DialogTitle>Manage account</DialogTitle>
				{/* <DialogDescription>
					This action cannot be undone. This will permanently delete your
					account and remove your data from our servers.
				</DialogDescription> */}

				{/* <Input></Input> */}
				{/* <InputField
						fieldClass="col-span-1"
						form={form}
						name="name"
						label="Name"
						onInput={() => triggerSave()}
					/> */}

				{/* // TODO: Change name */}
				{/* // TODO: Change email */}
				{/* // TODO: Delete account */}
			</DialogHeader>
		</DialogContent>
	);
}
