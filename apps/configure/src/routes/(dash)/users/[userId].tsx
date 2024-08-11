import {
	Avatar,
	AvatarFallback,
	AvatarImage,
	Badge,
	Button,
	Card,
	CardContent,
	CardTitle,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Input,
	buttonVariants,
} from "@mattrax/ui";
import { createEventListener } from "@solid-primitives/event-listener";
import { action, useAction, useSubmission } from "@solidjs/router";
import clsx from "clsx";
import { For, type JSX, Show, Suspense, createSignal, onMount } from "solid-js";
import { z } from "zod";
import { determineDeviceImage } from "~/assets";
import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";
import { getKey } from "~/lib/kv";
import { createDbQuery } from "~/lib/query";
import { useSync } from "~/lib/sync";
import { updateUser } from "~/lib/sync/mutations";
import { useZodParams } from "~/lib/useZodParams";

export default function Page() {
	const params = useZodParams({
		userId: z.string(),
	});
	const sync = useSync();

	const data = createDbQuery((db) => db.get("users", params.userId));
	// TODO: 404 handling

	const org = createDbQuery((db) => getKey(db, "org"));

	const entraIdLink = () => {
		const orgId = org()?.id;
		const userId = data()?.id;
		if (!orgId || !userId) return;
		return `https://portal.azure.com/${encodeURIComponent(orgId)}#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/~/overview/userId/${encodeURIComponent(userId)}`;
	};

	return (
		<PageLayout
			class="max-w-7xl space-y-2"
			heading={
				<div class="flex items-center space-x-4 p-4 w-full">
					{/* // TODO: Edit avatar */}
					<Avatar class="w-20 h-20">
						{/* // TODO: Hook this up */}
						<AvatarImage src="https://github.com/oscartbeaumont.png" />
						{/* // TODO: Hook this up */}
						<AvatarFallback>EK</AvatarFallback>
					</Avatar>

					<div>
						<h1 class="text-3xl font-bold">
							<Suspense
								fallback={
									<div class="w-42 h-8 rounded-full bg-neutral-200 animate-pulse" />
								}
							>
								{data()?.name}
							</Suspense>
						</h1>
						<h2 class="block mt-1 opacity-80 text-sm">
							<Suspense
								fallback={
									<div class="w-52 h-4 rounded-full bg-neutral-200 animate-pulse" />
								}
							>
								{data()?.upn}
							</Suspense>
						</h2>
						<span class="block mt-1 text-sm font-semibold">
							{data()?.type === "guest"
								? " Guest"
								: // biome-ignore lint/correctness/noConstantCondition: // TODO: Have the data to support this
									true
									? "Member"
									: "Administrator"}
						</span>
					</div>

					<div class="flex-1" />

					<div class="flex space-x-4">
						<a
							class={clsx(
								buttonVariants({ variant: "link" }),
								"!p-0",
								!entraIdLink() ? "cursor-default select-none" : "",
							)}
							target="_blank"
							href={entraIdLink()}
							rel="noreferrer"
						>
							Microsoft Entra ID
							<IconPrimeExternalLink class="inline ml-1" />
						</a>

						<DropdownMenu>
							<DropdownMenuTrigger as={Button}>
								Actions
								<IconPhCaretDown class="ml-1 w-3 h-3" />
							</DropdownMenuTrigger>
							<DropdownMenuContent>
								<DropdownMenuItem
									onClick={() => window.open(`mailto:${data()!.upn}`, "_blank")}
									disabled={data()?.upn === undefined}
								>
									Send email
								</DropdownMenuItem>
								<DropdownMenuItem
									class="text-destructive"
									onClick={() => alert("TODO")}
								>
									Reset password
								</DropdownMenuItem>
								<DropdownMenuItem
									class="text-destructive"
									onClick={() => alert("TODO")}
								>
									Revoke sessions
								</DropdownMenuItem>
								<DropdownMenuItem
									class="text-destructive"
									onClick={() => alert("TODO")}
								>
									Delete
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			}
		>
			<Card>
				<div class="p-8 grid grid-cols-4 gap-y-8 gap-x-4">
					<Field label="Identifier" value={data()?.id} />
					<Field
						label="Name"
						value={data()?.name}
						onChange={(name) =>
							updateUser(sync, {
								id: params.userId,
								name,
							})
						}
					/>
					<Field label="User principal name" value={data()?.upn} />
					<Field
						label="Account Status"
						value={data()?.accountEnabled}
						render={(v) => (
							<Show when={v === false} fallback={<Badge>Enabled</Badge>}>
								<Badge variant="destructive">Disabled</Badge>
							</Show>
						)}
					/>
					<Field label="Employee Identifier" value={data()?.employeeId} />
					{/* // TODO: Deal with multiple phones */}
					<Field label="Phone" value={data()?.phones?.[0] ?? ""} />
					<Field
						label="Last Password Change"
						value={data()?.lastPasswordChangeDateTime}
						render={renderDate}
					/>
					<Field
						label="Created At"
						value={data()?.createdDateTime}
						render={renderDate}
					/>
				</div>
			</Card>
			<Card>
				<div class="flex space-y-1.5 p-3 pr-6">
					<div class="p-3">
						<CardTitle>Devices</CardTitle>
					</div>

					<div class="flex-1" />

					<Button size="sm" onClick={() => alert("TODO")}>
						Assign
					</Button>
				</div>

				<CardContent class="flex flex-col space-y-4">
					{/* // TODO: Render in `For` & properly hook up the data w/ fallback state for zero items */}
					<For each={[0, 1]}>
						{(_) => (
							<a
								href="/fa875331-7b45-484d-bad4-9f0a327c5a19/devices/fa875331-7b45-484d-bad4-9f0a327c5a19"
								class="flex items-center space-x-8 border w-full rounded-md"
							>
								<div class="flex items-center">
									<img
										src={determineDeviceImage()}
										alt="todo"
										class="w-20 h-20"
									/>
									<div>
										<p class="text-xl font-medium tracking-tight">
											Oscar's Macbook Pro
										</p>
										<p class="text-sm text-stone-700 font-medium">
											Macbook Pro
										</p>
									</div>
								</div>
								<Field label="Operating System" value="macOS Sonoma" />
								<Field label="Enrollment Type" value="Microsoft Entra joined" />
								<Field label="Last Seen" value="21/01/2024, 15:42:43" />

								<div class="flex-1" />

								<div class="px-4">
									<Button
										variant="destructive"
										onClick={(e) => {
											e.preventDefault();
											alert("TODO");
										}}
									>
										Unlink
									</Button>
								</div>
							</a>
						)}
					</For>
				</CardContent>
			</Card>
			<Card>
				<div class="flex space-y-1.5 p-3 pr-6">
					<div class="p-3">
						<CardTitle>Groups</CardTitle>
					</div>

					<div class="flex-1" />

					<Button size="sm" onClick={() => alert("TODO")}>
						Assign
					</Button>
				</div>

				<CardContent class="flex flex-col space-y-4">
					{/* // TODO: Render in `For` & properly hook up the data w/ fallback state for zero items */}
					<For each={[0, 1]}>
						{(_) => (
							<a
								href="/fa875331-7b45-484d-bad4-9f0a327c5a19/devices/fa875331-7b45-484d-bad4-9f0a327c5a19"
								class="flex items-center space-x-8 border w-full rounded-md"
							>
								<div class="flex items-center p-4">
									<p class="text-xl font-medium tracking-tight">Developers</p>
								</div>
								<Field label="Users" value={99999} />
								<Field label="Devices" value={14} />
								<Field label="Policies" value={2} />

								<div class="flex-1" />

								<div class="px-4">
									<Button
										variant="destructive"
										onClick={(e) => {
											e.preventDefault();
											alert("TODO");
										}}
									>
										Remove
									</Button>
								</div>
							</a>
						)}
					</For>
				</CardContent>
			</Card>
		</PageLayout>
	);
}

// TODO: Break out somewhere else

export const renderDate = (d: string | undefined) =>
	d ? new Date(d).toLocaleString() : undefined;

export function Field<T>(props: {
	label: string;
	value: T | undefined;
	onChange?: (value: T) => Promise<void> | void;
	render?: (value: T | undefined) => JSX.Element;
}) {
	const render = (t: T | undefined) => {
		if (props.render) return props.render(t);
		return t as JSX.Element;
	};

	// TODO: Schema validation for new input?
	// TODO: Suspense fallback

	const [editing, setEditing] = createSignal(false);

	return (
		<div>
			<p class="text-sm text-stone-500 font-medium tracking-tight">
				{props.label}
			</p>
			<Show
				when={editing()}
				fallback={
					// biome-ignore lint/a11y/useKeyWithClickEvents:
					<p
						class="text-sm font-medium"
						onClick={(e) => {
							if (window.getSelection()?.toString() !== "") return;
							e.preventDefault();
							if (props.onChange) setEditing(true);
						}}
					>
						<Suspense>{render(props.value)}</Suspense>
					</p>
				}
			>
				{(_) => {
					let ref!: HTMLInputElement;

					const onChangeAction = action(async (data) => {
						await props.onChange?.(data);
						setEditing(false);
					});

					const trigger = useAction(onChangeAction);
					const state = useSubmission(onChangeAction);

					const fire = () => {
						if (state.pending) return;
						if (ref.value !== props.value) {
							trigger(ref.value);
						} else {
							setEditing(false);
						}
					};

					onMount(() => ref.focus());

					// TODO: Suspense?
					return (
						<Input
							ref={ref}
							value={props.value as any}
							disabled={state.pending}
							onKeyDown={(e) => {
								if (e.key === "Escape") setEditing(false);
								if (e.key === "Enter") fire();
							}}
							onFocusOut={() => {
								if (!editing()) return;
								setEditing(false);
								fire();
							}}
						/>
					);
				}}
			</Show>
		</div>
	);
}
