import { ParentProps, createSignal } from "solid-js";
import { z } from "zod";

import { Form, InputField, createZodForm } from "~/components/forms";
import {
	Button,
	DialogContent,
	DialogHeader,
	DialogRoot,
	DialogTitle,
} from "~/components/ui";
import { trpc } from "~/lib";

// TODO: Use form abstraction

export function CreateTenantDialog(
	props: {
		setActiveTenant: (id: string) => void;
	} & ParentProps,
) {
	const [open, setOpen] = createSignal(false);

	const mutation = trpc.tenant.create.useMutation(() => ({
		onSuccess: async (tenantId) => {
			// TODO: Get the data back in the response instead of a separate request
			// Session also holds tenants
			// await props.refetchSession();
			props.setActiveTenant(tenantId);
			setOpen(false);

			// Ensure the form stays disabled until the dialog is closed
			await new Promise((resolve) => setTimeout(resolve, 1000));
		},
	}));

	const form = createZodForm({
		schema: z.object({
			name: z.string(),
		}),
		onSubmit: ({ value }) => mutation.mutateAsync({ name: value.name }),
	});

	return (
		<DialogRoot open={open()} setOpen={setOpen}>
			{props.children}
			{/* // TODO: Fix mx-4 only offsetting from the left on mobile Safari */}
			<DialogContent class="w-full max-w-xl mx-4">
				<DialogHeader>
					<DialogTitle>Create Tenant</DialogTitle>
				</DialogHeader>
				<Form form={form} fieldsetClass="flex flex-col space-y-4">
					<InputField
						form={form}
						type="text"
						name="name"
						label="Name"
						placeholder="Acme School Inc"
						autocomplete="off"
					/>
					<Button type="submit">Create</Button>
				</Form>
			</DialogContent>
		</DialogRoot>
	);
}