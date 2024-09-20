import {
	Button,
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@mattrax/ui";
import { Form, InputField, createForm } from "@mattrax/ui/forms";
import { z } from "zod";
import { useTenantId } from "~/app/(dash)";
import { useBlueprint } from "~/lib/data";
import { trpc } from "~/lib/trpc";

export const route = {
	info: {
		title: "General",
		description: "Edit the general settings of the blueprint",
	},
};

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
				name: z
					.string()
					.min(1)
					.max(255)
					.default(blueprint.data?.name || ""),
				description: z
					.string()
					.min(1)
					.max(255)
					.default(blueprint.data?.description || ""),
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
				<InputField form={form} name="name" label="Name" />
				{/* // TODO: Make this a TextArea */}
				<InputField form={form} name="description" label="Description" />

				<Button>Save</Button>
			</Form>
		</>
	);

	// return (
	// 	<div class="w-full flex justify-center">
	// 		<div class="flex flex-col w-full max-w-3xl">
	// 			{/* <div class="flex justify-between">
	// 				<h1 class="text-3xl font-bold tracking-tight !mt-2 mb-4 md:mb-5">
	// 					Blueprint 0
	// 				</h1>

	// 				<div>{props.right ?? null}</div>
	// 			</div> */}

	// 			<Card>
	// 				<CardHeader>
	// 					<CardTitle>General</CardTitle>
	// 					{/* <CardDescription>
	// 					Edit the general settings of the blueprint
	// 				</CardDescription> */}
	// 				</CardHeader>
	// 				<CardContent>
	// 					<Form form={form} fieldsetClass="flex flex-col space-y-6">
	// 						<InputField form={form} name="name" label="Name" />
	// 						{/* <InputField form={form} name="billingEmail" label="Billing Email" /> */}
	// 					</Form>
	// 				</CardContent>
	// 				<CardFooter class="!px-6 !py-3 border-t">
	// 					<Button
	// 					// disabled={form.isSubmitting || !form.isValid}
	// 					// onClick={() => form.onSubmit()}
	// 					>
	// 						Save
	// 					</Button>
	// 				</CardFooter>
	// 			</Card>
	// 		</div>
	// 	</div>
	// );
}
