import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import { Button, Label } from "@mattrax/ui";
import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import { useNavigate } from "@solidjs/router";
import { Suspense, startTransition } from "solid-js";
import { z } from "zod";

import { trpc } from "~/lib";
import { ConfirmDialog } from "~c/ConfirmDialog";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { useTenantSlug } from "../../../t.[tenantSlug]";
import { PolicyContext, usePolicy } from "./Context";

export default function Page() {
	return (
		<PageLayout heading={<PageLayoutHeading>Settings</PageLayoutHeading>}>
			<Suspense>
				<PolicyContext>
					{(() => {
						const tenantSlug = useTenantSlug();
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
							...withDependantQueries(policy.query),
						}));

						const form = createZodForm({
							schema: z.object({ name: z.string() }),
							defaultValues: { name: policy().name || "" },
							onSubmit: ({ value }) => {
								updatePolicy.mutateAsync({
									id: policy().id,
									name: value.name,
								});
							},
						});

						return (
							<>
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
													description: (
														<>Are you sure you want to delete this policy?</>
													),
													inputText: policy().name,
													async onConfirm() {
														await deletePolicy.mutateAsync({ id: policy().id });

														await startTransition(() => navigate("../.."));
													},
												})
											}
										>
											Delete Policy
										</Button>
									)}
								</ConfirmDialog>
							</>
						);
					})()}
				</PolicyContext>
			</Suspense>
		</PageLayout>
	);
}
