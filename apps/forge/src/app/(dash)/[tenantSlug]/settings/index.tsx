import { z } from "zod";

import { useAuthContext } from "~/app/(dash)";
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
import { trpc, untrackScopeFromSuspense } from "~/lib";
import { useTenant } from "../../[tenantSlug]";
import { DeleteTenantButton } from "./DeleteTenantButton";

export default function Page() {
	return (
		<div class="flex flex-col gap-4">
			<SettingsCard />
			<ConfigureEnrollmentCard />
			<DeleteTenantCard />
		</div>
	);
}

function SettingsCard() {
	const auth = useAuthContext();
	const tenant = useTenant();

	// TODO: rollback form on failure
	const updateTenant = trpc.tenant.edit.useMutation(() => ({
		onSuccess: () => auth.meQuery.refetch(),
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

function ConfigureEnrollmentCard() {
	const tenant = useTenant();

	const enrollmentInfo = trpc.tenant.enrollmentInfo.useQuery(() => ({
		tenantSlug: tenant().slug,
	}));
	// TODO: Show correct state on the UI while the mutation is pending but keep fields disabled.
	const setEnrollmentInfo = trpc.tenant.setEnrollmentInfo.useMutation(() => ({
		onSuccess: () => enrollmentInfo.refetch(),
	}));
	const enrollmentEnabled = untrackScopeFromSuspense(
		() => enrollmentInfo.data?.enrollmentEnabled,
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Enrollment</CardTitle>
				<CardDescription>Configure how devices can enrollment</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col space-y-2">
				<div class="flex justify-between">
					<p>Enable enrollment</p>
					<Switch
						checked={enrollmentEnabled() ?? true}
						disabled={enrollmentEnabled() === undefined}
						onChange={(state) =>
							setEnrollmentInfo.mutate({
								enrollmentEnabled: state,
								tenantSlug: tenant().slug,
							})
						}
					/>
				</div>

				{/* // TODO: Integrate with Apple DEP */}
				{/* // TODO: Integrate with Apple user-initiated enrollment */}
				{/* // TODO: Integrate with Microsoft user-initiated enrollment */}
				{/* // TODO: Integrate with Android user-initiated enrollment */}
			</CardContent>
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
