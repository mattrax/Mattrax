import { z } from "zod";

import { Form, createZodForm } from "~/components/forms";
import { InputField } from "~/components/forms/InputField";
import {
	Button,
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
	Switch,
} from "~/components/ui";
import { trpc } from "~/lib";
import { DeleteTenantButton } from "./DeleteTenantButton";
import { AuthContext, useAuth } from "../../AuthContext";
import { TenantContext, useTenant } from "../../TenantContext";

export default function Page() {
	return (
		<div class="flex flex-col gap-4">
			<SettingsCard />
			<DeleteTenantCard />
		</div>
	);
}

function SettingsCard() {
	const auth = useAuth();
	const tenant = useTenant();

	// TODO: rollback form on failure
	const updateTenant = trpc.tenant.edit.useMutation(() => ({
		onSuccess: () => auth.query.refetch(),
	}));

	const form = createZodForm({
		schema: z.object({ name: z.string(), slug: z.string() }),
		defaultValues: {
			name: tenant().name,
			slug: tenant().slug,
		},
		onSubmit: ({ value }) =>
			updateTenant.mutateAsync({
				name: value.name,
				tenantSlug: tenant().slug,
			}),
	});

	return (
		<Card class="flex flex-col">
			<CardHeader>
				<CardTitle>Tenant Settings</CardTitle>
				<CardDescription>Basic tenant configuration.</CardDescription>
			</CardHeader>
			<Form form={form}>
				<CardContent class="justify-between gap-x-2 gap-y-3 grid grid-cols-1 md:grid-cols-2">
					<InputField class="col-span-1" form={form} name="name" label="Name" />
					<InputField class="col-span-1" form={form} name="slug" label="Slug" />
				</CardContent>
				<CardFooter>
					<Button type="submit">Save</Button>
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
