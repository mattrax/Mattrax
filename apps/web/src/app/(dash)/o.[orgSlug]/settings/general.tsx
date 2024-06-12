import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import { z } from "zod";
import { useOrg, useOrgSlug } from "../ctx";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@mattrax/ui";
import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import { trpc } from "~/lib";
import { ConfirmDialog } from "~/components/ConfirmDialog";

export default function Page() {
	const orgSlug = useOrgSlug();
	const org = useOrg();

	const tenants = trpc.org.tenants.createQuery(() => ({
		orgSlug: orgSlug(),
	}));

	const editOrg = trpc.org.edit.createMutation(() => ({
		...withDependantQueries(org.query),
	}));

	const form = createZodForm({
		schema: z.object({
			name: z.string(),
			slug: z.string(),
		}),
		defaultValues: () => ({
			name: org()?.name || "",
			slug: org()?.slug || "",
		}),
		onSubmit: ({ value }) =>
			editOrg.mutateAsync({
				orgSlug: orgSlug(),
				name: value.name,
				slug: value.slug,
			}),
	});

	return (
		<div>
			<h1 class="text-2xl font-semibold">Organisation Settings</h1>
			<p class="mt-2 mb-3 text-gray-700 text-sm">
				Manage your Mattrax organisation
			</p>
			<div class="flex flex-col gap-4">
				<Form
					form={form}
					fieldsetClass="justify-between gap-x-2 gap-y-3 grid grid-cols-1 md:grid-cols-2 pt-2"
				>
					<InputField
						fieldClass="col-span-1"
						form={form}
						name="name"
						label="Name"
					/>
					<InputField
						fieldClass="col-span-1"
						form={form}
						name="slug"
						label="Slug"
					/>

					<div class="flex space-x-4">
						<Button type="submit">Update</Button>

						<ConfirmDialog>
							{(confirm) => (
								<Tooltip openDelay={10}>
									<TooltipTrigger as="div">
										<Button
											variant="destructive"
											disabled={
												org.query.isPending ||
												tenants.isPending ||
												!tenants.data ||
												tenants.data.length > 0
											}
											onClick={() => {
												console.log(1);
												confirm({
													title: "Delete organisation?",
													action: `Delete '${org()?.name}'`,
													description: () => (
														<>
															Are you sure you want to delete your organisation?
														</>
													),
													inputText: org()?.name || "",
													async onConfirm() {
														// TODO: Allow deleting your organisation without support
														window.location.assign(
															`mailto:hello@mattrax.app?subject=Request to delete organisation&body=Hello, %0D%0A%0D%0A I would like to delete my organisation. %0D%0A%0D%0A Thanks! %0D%0A%0D%0A Org ID: ${
																org()?.id
															}`,
														);
													},
												});
											}}
										>
											Delete Account
										</Button>
									</TooltipTrigger>
									{tenants.data && tenants.data.length > 0 ? (
										<TooltipContent>
											You must delete your {tenants.data.length} tenants first!
										</TooltipContent>
									) : null}
								</Tooltip>
							)}
						</ConfirmDialog>
					</div>
				</Form>
			</div>
		</div>
	);
}
