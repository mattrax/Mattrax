import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import {
	Button,
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@mattrax/ui";
import { Form, createZodForm } from "@mattrax/ui/forms";
import { InputField } from "@mattrax/ui/forms";
import { type RouteDefinition, useNavigate } from "@solidjs/router";
import { z } from "zod";

import { ConfirmDialog } from "~/components/ConfirmDialog";
import { trpc } from "~/lib";
import { useOrgSlug } from "../../ctx";
import { useTenant, useTenantSlug } from "../ctx";
import { DeleteTenantButton } from "./DeleteTenantButton";

export default function Page() {
	return (
		<div class="flex flex-col gap-4">
			<SettingsCard />
			<DeleteTenantCard />
		</div>
	);
}

function SettingsCard() {
	const navigate = useNavigate();
	const orgSlug = useOrgSlug();
	const tenantSlug = useTenantSlug();
	const tenant = useTenant();

	// TODO: rollback form on failure
	const updateTenant = trpc.tenant.edit.createMutation(() => ({
		onSuccess: (_, input) => {
			if (input.slug && input.slug !== input.tenantSlug)
				navigate(`/o/${orgSlug()}/t/${input.slug}/settings`);
		},
		...withDependantQueries(tenant.query, {
			blockOn: true,
		}),
	}));

	const form = createZodForm(() => ({
		schema: z.object({ name: z.string(), slug: z.string() }),
		defaultValues: {
			name: tenant()?.name || "",
			slug: tenant()?.slug || "",
		},
		onSubmit: ({ value }) =>
			updateTenant.mutateAsync({
				name: value.name,
				slug: value.slug,
				tenantSlug: tenantSlug(),
			}),
	}));

	return (
		<Card class="flex flex-col">
			<CardHeader>
				<CardTitle>Tenant Settings</CardTitle>
				<CardDescription>Basic tenant configuration.</CardDescription>
			</CardHeader>
			<Form form={form} disabled={tenant.query.isPending}>
				<CardContent class="justify-between gap-x-2 gap-y-3 grid grid-cols-1 md:grid-cols-2">
					<InputField class="col-span-1" form={form} name="name" label="Name" />
					<InputField class="col-span-1" form={form} name="slug" label="Slug" />
				</CardContent>
				<CardFooter>
					<ConfirmDialog>
						{(confirm) => (
							<Button
								disabled={tenant.query.isPending}
								onClick={() => {
									if (form.getFieldValue("slug") !== tenant()?.slug) {
										confirm({
											title: "Change slug?",
											action: `I'm sure`,
											description: () => (
												<>
													You are about to change your tenants's slug.
													<br />
													This will <b>break all existing URLs</b> to your
													tenant.
												</>
											),
											onConfirm: () => form.handleSubmit(),
										});
									} else {
										form.handleSubmit();
									}
								}}
							>
								Update
							</Button>
						)}
					</ConfirmDialog>
				</CardFooter>
			</Form>
		</Card>
	);
}

function DeleteTenantCard() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Delete Tenant</CardTitle>
				<CardDescription>
					Permanently delete your tenant and all its data.
				</CardDescription>
			</CardHeader>
			<CardFooter>
				<DeleteTenantButton />
			</CardFooter>
		</Card>
	);
}
