import { z } from "zod";
import { useTenant } from "~/app/(dash)/[tenantSlug]";
import { Form, InputField, createZodForm } from "~/components/forms";
import { Button, Label } from "~/components/ui";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { PageLayout, PageLayoutHeading } from "../../PageLayout";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { usePolicy } from "../[policyId]";
import { useNavigate } from "@solidjs/router";
import { startTransition } from "solid-js";

export default function Page() {
	const navigate = useNavigate();
	const tenant = useTenant();
	const policy = usePolicy();

	const deletePolicy = trpc.policy.delete.useMutation();
	// const updatePolicy = trpc.policy.update.useMutation(() => ({
	// 	onSuccess: () => policy.refetch(),
	// }));

	const form = createZodForm({
		schema: z.object({ name: z.string() }),
		defaultValues: { name: policy().data?.name || "" },
		onSubmit: ({ value }) => {
			// updatePolicy.mutateAsync({
			// 	tenantSlug: tenant().slug,
			// 	policyId: params.policyId,
			// 	name: value.name,
			// });
			alert("TODO");
		},
	});

	return (
		<PageLayout heading={<PageLayoutHeading>Settings</PageLayoutHeading>}>
			<Form form={form} fieldsetClass="space-y-2">
				<Label for="name">Name</Label>
				<InputField
					form={form}
					type="text"
					name="name"
					placeholder="My Cool Policy"
				/>

				<Button type="submit" class="w-full">
					<span class="text-sm font-semibold leading-6">Save</span>
				</Button>
			</Form>

			<ConfirmDialog>
				{(confirm) => (
					<Button
						variant="destructive"
						onClick={() =>
							confirm({
								title: "Delete policy?",
								action: `Delete '${policy().name}'`,
								description: <>Are you sure you want to delete this policy?</>,
								inputText: policy().name,
								async onConfirm() {
									await deletePolicy.mutateAsync({
										tenantSlug: tenant().slug,
										policyId: policy().id,
									});

									await startTransition(() => navigate("../.."));
								},
							})
						}
					>
						Delete Policy
					</Button>
				)}
			</ConfirmDialog>
		</PageLayout>
	);
}
