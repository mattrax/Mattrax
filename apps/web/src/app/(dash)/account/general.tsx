import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import { Button } from "@mattrax/ui";
import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import { debounce } from "@solid-primitives/scheduled";
import { toast } from "solid-sonner";
import { z } from "zod";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { trpc } from "~/lib";

export default function Page() {
	const me = trpc.auth.me.createQuery();

	// TODO: rollback form on failure
	const updateAccount = trpc.auth.update.createMutation(() => ({
		onSuccess: () =>
			toast.success("Account updated", {
				id: "account-updated",
			}),
		...withDependantQueries(me),
	}));

	const form = createZodForm({
		schema: z.object({ name: z.string(), email: z.string().email() }),
		// TODO: We should use a function for this so it updates from the server data when the fields aren't dirty.
		// TODO: Right now this breaks the field focus
		defaultValues: {
			name: me.data?.name || "",
			email: me.data?.email || "",
		},
		onSubmit: ({ value }) =>
			updateAccount.mutateAsync({
				name: value.name,
			}),
	});

	const triggerSave = debounce(() => {
		// TODO: This should probs use the form but it disabled the field which is annoying AF.
		updateAccount.mutateAsync({
			name: form.getFieldValue("name"),
		});
	}, 500);

	return (
		<div>
			<h1 class="text-2xl font-semibold">Account Settings</h1>
			<p class="mt-2 mb-3 text-gray-700 text-sm">Manage your Mattrax account</p>
			<Form
				form={form}
				fieldsetClass="justify-between gap-x-2 gap-y-3 grid grid-cols-1 md:grid-cols-2 pt-2"
			>
				<InputField
					fieldClass="col-span-1"
					form={form}
					name="name"
					label="Name"
					onInput={() => triggerSave()}
				/>
				<div class="col-span-1">
					{/* TODO: Allow modifying email and verifying new one without support */}
					<InputField form={form} name="email" label="Email" disabled={true} />
					<p class="text-muted-foreground opacity-80 text-sm">
						Please contact{" "}
						<a
							href={`mailto:hello@mattrax.app?subject=Request to change email&body=Hello, %0D%0A%0D%0A I would like to change my email to 'new_email'. %0D%0A%0D%0A Thanks! %0D%0A%0D%0A Account ID: ${me.data?.id}`}
							class="italic underline"
						>
							hello@mattrax.app
						</a>
						!
					</p>
				</div>

				<div>
					<ConfirmDialog>
						{(confirm) => (
							<Button
								variant="destructive"
								disabled={me.isPending}
								onClick={() =>
									confirm({
										title: "Delete account?",
										action: `Delete '${me.data?.email}'`,
										description: () => (
											<>Are you sure you want to delete your account?</>
										),
										inputText: me.data?.email || "",
										async onConfirm() {
											// TODO: Allow deleting your account without support
											window.location.assign(
												`mailto:hello@mattrax.app?subject=Request to delete account&body=Hello, %0D%0A%0D%0A I would like to delete my account. %0D%0A%0D%0A Thanks! %0D%0A%0D%0A Account ID: ${me.data?.id}`,
											);
										},
									})
								}
							>
								Delete Account
							</Button>
						)}
					</ConfirmDialog>
				</div>
			</Form>
		</div>
	);
}
