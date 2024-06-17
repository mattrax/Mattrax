import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import { Button, Label } from "@mattrax/ui";
import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import { useNavigate } from "@solidjs/router";
import { startTransition } from "solid-js";
import { z } from "zod";

import { trpc } from "~/lib";
import { ConfirmDialog } from "~c/ConfirmDialog";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { useTenantSlug } from "../../ctx";
import { usePolicy, usePolicyId } from "../ctx";

export default function Page() {
	const tenantSlug = useTenantSlug();
	const policyId = usePolicyId();
	const policy = usePolicy();

	const navigate = useNavigate();

	const userList = trpc.user.list.createQuery(
		() => ({
			tenantSlug: tenantSlug(),
		}),
		() => ({ enabled: false }),
	);

	const deletePolicy = trpc.policy.delete.createMutation(() => ({
		...withDependantQueries(userList),
	}));

	const updatePolicy = trpc.policy.update.createMutation(() => ({
		...withDependantQueries(policy),
	}));

	const form = createZodForm({
		schema: z.object({ name: z.string() }),
		defaultValues: () => ({
			name: policy.data?.name || "",
		}),
		onSubmit: ({ value }) => {
			updatePolicy.mutateAsync({
				id: policyId(),
				name: value.name,
			});
		},
	});

	return (
		<PageLayout heading={<PageLayoutHeading>Settings</PageLayoutHeading>}>
			<Form form={form} fieldsetClass="space-y-2" disabled={policy.isPending}>
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
						disabled={policy.isPending}
						onClick={() =>
							confirm({
								title: "Delete policy?",
								action: `Delete '${policy.data!.name}'`,
								description: () =>
									"Are you sure you want to delete this policy?",
								inputText: policy.data!.name,
								async onConfirm() {
									await deletePolicy.mutateAsync({
										tenantSlug: tenantSlug(),
										ids: [policyId()],
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
