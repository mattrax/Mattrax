import { type ParentProps, Show, createSignal, For, Suspense } from "solid-js";
import { As } from "@kobalte/core";
import clsx from "clsx";
import { z } from "zod";

import IconMaterialSymbolsWarningRounded from "~icons/material-symbols/warning-rounded.jsx";
import IconPrimeExternalLink from "~icons/prime/external-link.jsx";
import {
	Button,
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogRoot,
	DialogTitle,
	DialogTrigger,
	buttonVariants,
} from "@mattrax/ui";
import { AUTH_PROVIDER_DISPLAY, userAuthProviderUrl } from "~/lib/values";
import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import { trpc } from "~/lib";
import { useUser } from "./Context";
import { BruhIconPhLaptop } from "./bruh";
import { A } from "@solidjs/router";
import {
	AddMemberSheet,
	memberSheetColumns,
} from "~[tenantSlug]/AddMemberSheet";
import { StandardTable, createStandardTable } from "~/components/StandardTable";

export default function Page() {
	const user = useUser();

	return (
		<div class="px-4 py-8 w-full max-w-5xl mx-auto flex flex-col gap-4">
			<div class="flex flex-row justify-between">
				<div>
					<h1 class="text-3xl font-bold">{user().name}</h1>
					<span class="block mt-1 text-gray-700 text-sm">{user().email}</span>
					<Show
						when={user().providerResourceId}
						fallback={
							<span class="flex flex-row items-center text-sm py-2.5 gap-1 font-medium">
								<IconMaterialSymbolsWarningRounded class="w-5 h-5 text-yellow-600" />
								User not found in{" "}
								{AUTH_PROVIDER_DISPLAY[user().provider.variant]}
							</span>
						}
					>
						{(resourceId) => (
							<a
								class={clsx(buttonVariants({ variant: "link" }), "!p-0")}
								target="_blank"
								href={
									userAuthProviderUrl(
										user().provider.variant,
										user().provider.remoteId,
										resourceId(),
									)!
								}
								rel="noreferrer"
							>
								{AUTH_PROVIDER_DISPLAY[user().provider.variant]}
								<IconPrimeExternalLink class="inline ml-1" />
							</a>
						)}
					</Show>
				</div>
			</div>

			<Devices />
			<Policies />

			<h1 class="text-muted-foreground">
				To make changes use your identity providers portal!
			</h1>
		</div>
	);
}

function Devices() {
	const user = useUser();
	const devices = trpc.user.getDevices.useQuery(() => ({
		id: user().id,
	}));

	return (
		<Card>
			<CardHeader>
				<div class="flex justify-between items-center">
					<CardTitle>Devices</CardTitle>

					<SendInstructionsDialog id={user().id} email={user().email}>
						<As component={Button}>Send Instructions</As>
					</SendInstructionsDialog>
				</div>
			</CardHeader>
			<CardContent>
				<div class="flex flex-col space-y-2">
					<For each={devices.data}>
						{(device) => (
							<A href={`../../devices/${device.id}`}>
								<div class="flex items-center space-x-2 border rounded-md p-2">
									<span class="text-4xl">
										<BruhIconPhLaptop />
									</span>
									<div>
										<p class="text-xl">{device.name}</p>
										<p class="text-sm text-gray-600">Windows</p>
									</div>
								</div>
							</A>
						)}
					</For>
				</div>
			</CardContent>
		</Card>
	);
}

function Policies() {
	const user = useUser();

	const members = trpc.user.members.useQuery(() => ({
		id: user().id,
	}));

	const table = createStandardTable({
		get data() {
			return members.data ?? [];
		},
		columns: memberSheetColumns,
		pagination: true,
	});

	const addMembers = trpc.user.addMembers.useMutation(() => ({
		onSuccess: () => members.refetch(),
	}));

	return (
		<Card>
			<CardHeader>
				<div class="flex justify-between items-center">
					<CardTitle>Policies</CardTitle>

					<AddMemberSheet
						// @ts-expect-error // TODO: Fix this
						addMember={(members) =>
							addMembers.mutateAsync({
								id: user().id,
								members,
							})
						}
					>
						<As component={Button} class="ml-auto">
							Add Member
						</As>
					</AddMemberSheet>
				</div>
			</CardHeader>
			<CardContent>
				<Suspense>
					<StandardTable table={table} />
				</Suspense>
			</CardContent>
		</Card>
	);
}

function SendInstructionsDialog(
	props: ParentProps<{ id: string; email: string }>,
) {
	const [open, setOpen] = createSignal(false);

	const mutation = trpc.user.invite.useMutation();

	const form = createZodForm({
		schema: z.object({ message: z.string().email().optional() }),
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync({
				id: props.id,
				message: value.message,
			});
			setOpen(false);
		},
	});

	return (
		<DialogRoot
			open={open()}
			setOpen={(o) => {
				if (o) form.setFieldValue("message", "");
				setOpen(o);
			}}
		>
			<DialogTrigger asChild>{props.children}</DialogTrigger>
			<DialogContent class="max-w-md">
				<DialogHeader>
					<DialogTitle>Send Instructions</DialogTitle>
					<DialogDescription>
						We will send an email to <b>{props.email}</b> with instructions on
						how to enroll their device in this tenant.
					</DialogDescription>
				</DialogHeader>
				<Form form={form} fieldsetClass="space-y-2">
					{/* TODO: Show this as optional + make it a text area */}
					<InputField
						form={form}
						type="text"
						name="message"
						placeholder="Your custom message"
						autocomplete="off"
					/>
					<Button type="submit" class="w-full">
						Send Invitation
					</Button>
				</Form>
			</DialogContent>
		</DialogRoot>
	);
}
