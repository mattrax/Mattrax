import { Button } from "@mattrax/ui";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@mattrax/ui";
import { CheckboxField, Form, InputField, createForm } from "@mattrax/ui/forms";
import { z } from "zod";
import { useTenantId } from "~/app/(dash)";
import { trpc } from "~/lib";
import { useBlueprint } from "~/lib/data";

export default function () {
	const tenantId = useTenantId();
	const blueprint = useBlueprint();

	const updateBlueprint = trpc.blueprint.update.createMutation(() => ({
		// TODO: dependant queries
		// onSuccess: () =>
		// 	Promise.all([
		// 		ctx.tenant.list.invalidate(),
		// 		ctx.tenant.settings.get.invalidate(),
		// 	]),
	}));
	const deleteBlueprint = trpc.blueprint.delete.createMutation(() => ({
		// onSuccess: () => startTransition(() => navigate("/")),
	}));

	const form = createForm({
		schema: () =>
			z.object({
				diskEncryption: z.boolean(),
				// .default(blueprint.data?.name || ""),
			}),
		onSubmit: (data) =>
			updateBlueprint.mutateAsync({
				tenantId: tenantId(),
				...data,
			}),
	});

	return (
		<>
			<Form form={form} fieldsetClass="flex flex-col space-y-6 max-w-2xl">
				{/* // TODO: Require password */}

				<CheckboxField
					form={form}
					name="diskEncryption"
					label="Full Disk Encryption"
					description={
						<>
							Enable at rest encryption for all data for all devices. <br />
							This uses BitLocker on Windows and FileVault on macOS.
						</>
					}
				/>

				<Button>Save</Button>
			</Form>
		</>
	);

	// return (
	// 	<>
	// 		<Card>
	// 			<CardHeader>
	// 				<CardTitle>General</CardTitle>
	// 				<CardDescription>
	// 					Edit the general settings of the blueprint
	// 				</CardDescription>
	// 			</CardHeader>
	// 			<CardContent>
	// 				<Form form={form} fieldsetClass="flex flex-col space-y-6">
	// 					<InputField form={form} name="name" label="Name" />
	// 					{/* <InputField form={form} name="billingEmail" label="Billing Email" /> */}
	// 				</Form>
	// 			</CardContent>
	// 			<CardFooter class="!px-6 !py-3 border-t">
	// 				<Button
	// 				// disabled={form.isSubmitting || !form.isValid}
	// 				// onClick={() => form.onSubmit()}
	// 				>
	// 					Save
	// 				</Button>
	// 			</CardFooter>
	// 		</Card>
	// 	</>
	// );
}
