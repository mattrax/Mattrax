import { Button } from "@mattrax/ui";
import { Form, InputField, createForm } from "@mattrax/ui/forms";
import { useNavigate } from "@solidjs/router";
import { z } from "zod";
import { useTenantId } from "~/app/(dash)";
import { trpc } from "~/lib";

// TODO: I wanna merge this with the blueprint editor so you can start authoring without doing a create first?

export default function () {
	const tenantId = useTenantId();
	const navigate = useNavigate();
	const createBlueprint = trpc.blueprint.create.createMutation(() => ({
		onSuccess: (id) => navigate(`../${id}`),
	}));

	const form = createForm({
		schema: () =>
			z.object({
				name: z.string().min(1).max(255),
			}),
		onSubmit: (data) =>
			createBlueprint.mutateAsync({
				tenantId: tenantId(),
				...data,
			}),
	});

	return (
		<Form
			form={form}
			fieldsetClass="flex flex-col space-y-6 max-w-2xl"
			class="p-4"
		>
			<InputField form={form} name="name" label="Name" />

			<Button type="submit">Create</Button>
		</Form>
	);
}
