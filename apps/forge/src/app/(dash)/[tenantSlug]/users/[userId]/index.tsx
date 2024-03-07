import { ParentProps, Show, createSignal } from "solid-js";
import { As } from "@kobalte/core";
import clsx from "clsx";
import { z } from "zod";

import { useUser } from "../[userId]";
import { useTenant } from "~/app/(dash)/TenantContext";
import {
	Badge,
	Button,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogRoot,
	DialogTitle,
	DialogTrigger,
	buttonVariants,
} from "~/components/ui";
import { AUTH_PROVIDER_DISPLAY, userAuthProviderUrl } from "~/lib/values";
import { Form, InputField, createZodForm } from "~/components/forms";
import { trpc } from "~/lib";
import { useTenantSlug } from "~/app/(dash)/[tenantSlug]";

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

				<InviteUserDialog id={user().id} email={user().email}>
					<As component={Button}>Invite</As>
				</InviteUserDialog>
			</div>

			<h1 class="text-muted-foreground">
				Users can be managed in your identity providers portal!
			</h1>
		</div>
	);
}

function InviteUserDialog(props: ParentProps<{ id: string; email: string }>) {
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
				if (o) form.setFieldValue("email", "");
				setOpen(o);
			}}
		>
			<DialogTrigger asChild>{props.children}</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Invite User</DialogTitle>
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
